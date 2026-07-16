#!/usr/bin/env python3
"""Isolated WSS/MQTT relay for the context-detective dashboard."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from collections import OrderedDict
from typing import Any


PROJECT_ID = "smartlife-junior-context"
PROFILE_ID = "smartlife-junior-context-detective-v1"
BASE_TOPIC = "smartlife/context-detective/n16r8"
BOARD_TYPES = {"hello", "telemetry", "health", "ack"}
RETAINED_BOARD_TYPES = {"hello", "telemetry", "health"}
CLIENT_TYPES = BOARD_TYPES | {"command", "ping"}
PRIVATE_KEYS = {"_relayId", "mqttTopic"}


def json_payload(raw: bytes | str) -> dict[str, Any] | None:
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        payload = json.loads(raw)
    except (UnicodeDecodeError, TypeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def matches_identity(payload: Any) -> bool:
    return (
        isinstance(payload, dict)
        and payload.get("project") == PROJECT_ID
        and payload.get("profileId") == PROFILE_ID
    )


def valid_board_frame(payload: Any) -> bool:
    return matches_identity(payload) and payload.get("type") in BOARD_TYPES


def valid_command(payload: Any) -> bool:
    if not matches_identity(payload) or payload.get("type") != "command":
        return False
    if not isinstance(payload.get("id"), str) or not payload["id"].strip():
        return False
    operations = [key for key in ("mode", "set", "actuator", "contextConfirm", "contextCorrect", "mockScenario") if key in payload]
    return len(operations) == 1


def mqtt_topics_to_subscribe() -> list[str]:
    return [f"{BASE_TOPIC}/{name}" for name in (*sorted(BOARD_TYPES), "command")]


def topic_for(payload: dict[str, Any]) -> str:
    return f"{BASE_TOPIC}/{payload['type']}"


def broadcast_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key not in PRIVATE_KEYS and not key.startswith("_")}


def publish_route_for_client_message(message: bytes | str) -> tuple[str, str, bool] | None:
    payload = json_payload(message)
    if not payload or payload.get("type") == "ping":
        return None
    if valid_board_frame(payload):
        if payload.get("origin") != "web-serial-gateway" or not payload.get("originClientId"):
            return None
        retain = payload["type"] in RETAINED_BOARD_TYPES
        return topic_for(payload), json.dumps(payload, ensure_ascii=False, separators=(",", ":")), retain
    if valid_command(payload):
        if payload.get("usbWritten") is True:
            return None
        return f"{BASE_TOPIC}/command", json.dumps(payload, ensure_ascii=False, separators=(",", ":")), False
    return None


def reason_code_failed(reason_code: Any) -> bool:
    failure = getattr(reason_code, "is_failure", None)
    if failure is not None:
        return bool(failure)
    try:
        return int(reason_code) != 0
    except (TypeError, ValueError):
        return True


def configured_origins(env: dict[str, str] | None = None) -> set[str]:
    env = os.environ if env is None else env
    raw = env.get("RELAY_ALLOWED_ORIGINS", "http://127.0.0.1:18767,http://localhost:18767")
    return {value.strip().rstrip("/") for value in raw.split(",") if value.strip()}


def origin_allowed(origin: str, allowed: set[str] | None = None) -> bool:
    if not origin:
        return False
    return origin.rstrip("/") in (configured_origins() if allowed is None else allowed)


def websocket_origin(websocket: Any) -> str:
    request = getattr(websocket, "request", None)
    headers = getattr(request, "headers", None)
    if headers is not None:
        return headers.get("Origin", "")
    headers = getattr(websocket, "request_headers", None)
    return headers.get("Origin", "") if headers is not None else ""


class CloudRelay:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.clients: set[Any] = set()
        self.last_frames: OrderedDict[str, str] = OrderedDict()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.mqtt_client: Any = None
        self.mqtt_connected = False
        self.relay_id = f"context-relay-{uuid.uuid4().hex[:12]}"

    def status_payload(self) -> dict[str, Any]:
        return {
            "type": "relayStatus",
            "project": PROJECT_ID,
            "profileId": PROFILE_ID,
            "service": "smartlife-context-relay",
            "mqttConnected": self.mqtt_connected,
            "ts": int(time.time() * 1000),
        }

    def remember(self, payload: dict[str, Any]) -> None:
        if payload.get("type") not in RETAINED_BOARD_TYPES:
            return
        self.last_frames[payload["type"]] = json.dumps(broadcast_payload(payload), ensure_ascii=False)

    async def broadcast(self, payload: dict[str, Any], exclude: Any = None) -> None:
        if not self.clients:
            return
        message = json.dumps(broadcast_payload(payload), ensure_ascii=False)
        disconnected = []
        for client in list(self.clients):
            if client is exclude:
                continue
            try:
                await client.send(message)
            except Exception:
                disconnected.append(client)
        for client in disconnected:
            self.clients.discard(client)

    def schedule_broadcast(self, payload: dict[str, Any]) -> None:
        if self.loop is not None:
            asyncio.run_coroutine_threadsafe(self.broadcast(payload), self.loop)

    def start_mqtt(self) -> None:
        try:
            import paho.mqtt.client as mqtt
        except Exception as exc:
            raise RuntimeError("paho-mqtt missing; install tools/requirements.txt") from exc

        self.mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=self.args.mqtt_client_id)
        if self.args.mqtt_username:
            self.mqtt_client.username_pw_set(self.args.mqtt_username, self.args.mqtt_password)

        def on_connect(client, userdata, flags, reason_code, properties):
            self.mqtt_connected = not reason_code_failed(reason_code)
            if self.mqtt_connected:
                for topic in mqtt_topics_to_subscribe():
                    client.subscribe(topic)
            print(f"mqtt connected={int(self.mqtt_connected)}", flush=True)
            self.schedule_broadcast(self.status_payload())

        def on_disconnect(client, userdata, disconnect_flags, reason_code, properties):
            self.mqtt_connected = False
            print("mqtt connected=0", flush=True)
            self.schedule_broadcast(self.status_payload())

        def on_message(client, userdata, message):
            payload = json_payload(message.payload)
            if not payload or payload.get("_relayId") == self.relay_id:
                return
            if valid_board_frame(payload):
                self.remember(payload)
                self.schedule_broadcast(payload)
            elif valid_command(payload):
                self.schedule_broadcast(payload)

        self.mqtt_client.on_connect = on_connect
        self.mqtt_client.on_disconnect = on_disconnect
        self.mqtt_client.on_message = on_message
        self.mqtt_client.connect_async(self.args.mqtt_host, self.args.mqtt_port, 60)
        self.mqtt_client.loop_start()

    def publish(self, topic: str, message: str, retain: bool) -> bool:
        if not self.mqtt_client or not self.mqtt_connected:
            return False
        payload = json_payload(message)
        if payload is None:
            return False
        payload["_relayId"] = self.relay_id
        self.mqtt_client.publish(topic, json.dumps(payload, ensure_ascii=False, separators=(",", ":")), retain=retain)
        return True

    async def handler(self, websocket: Any) -> None:
        if not origin_allowed(websocket_origin(websocket), self.args.allowed_origins):
            await websocket.close(code=4403, reason="origin forbidden")
            return
        self.clients.add(websocket)
        await websocket.send(json.dumps(self.status_payload(), ensure_ascii=False))
        for message in self.last_frames.values():
            await websocket.send(message)
        try:
            async for message in websocket:
                route = publish_route_for_client_message(message)
                if route is None:
                    continue
                topic, mqtt_message, retain = route
                payload = json_payload(mqtt_message)
                if payload is None:
                    continue
                if payload["type"] in BOARD_TYPES:
                    self.remember(payload)
                self.publish(topic, mqtt_message, retain)
                if payload["type"] == "command":
                    print(f"ws command id={payload.get('id', '')} peers={max(0, len(self.clients) - 1)}", flush=True)
                await self.broadcast(payload, exclude=websocket)
        except Exception as exc:
            if not exc.__class__.__name__.startswith("ConnectionClosed"):
                print(f"websocket client ignored={exc.__class__.__name__}", flush=True)
        finally:
            self.clients.discard(websocket)

    async def run(self) -> None:
        try:
            import websockets
        except Exception as exc:
            raise RuntimeError("websockets missing; install tools/requirements.txt") from exc
        self.loop = asyncio.get_running_loop()
        self.start_mqtt()
        server = await websockets.serve(self.handler, self.args.ws_host, self.args.ws_port, max_size=1_000_000)
        print(f"context relay listening ws://{self.args.ws_host}:{self.args.ws_port}", flush=True)
        try:
            await asyncio.Future()
        finally:
            server.close()
            await server.wait_closed()
            if self.mqtt_client is not None:
                self.mqtt_client.loop_stop()
                self.mqtt_client.disconnect()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Context detective WSS/MQTT relay")
    parser.add_argument("--ws-host", default=os.getenv("RELAY_WS_HOST", "127.0.0.1"))
    parser.add_argument("--ws-port", type=int, default=int(os.getenv("RELAY_WS_PORT", "19466")))
    parser.add_argument("--mqtt-host", default=os.getenv("MQTT_HOST", "127.0.0.1"))
    parser.add_argument("--mqtt-port", type=int, default=int(os.getenv("MQTT_PORT", "19483")))
    parser.add_argument("--mqtt-username", default=os.getenv("MQTT_USERNAME", ""))
    parser.add_argument("--mqtt-password", default=os.getenv("MQTT_PASSWORD", ""))
    parser.add_argument("--mqtt-client-id", default=os.getenv("MQTT_CLIENT_ID", "smartlife-context-relay"))
    parser.add_argument("--allowed-origins", default=os.getenv("RELAY_ALLOWED_ORIGINS", ""))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.allowed_origins = (
        {value.strip().rstrip("/") for value in args.allowed_origins.split(",") if value.strip()}
        if isinstance(args.allowed_origins, str) and args.allowed_origins.strip()
        else configured_origins()
    )
    try:
        asyncio.run(CloudRelay(args).run())
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
