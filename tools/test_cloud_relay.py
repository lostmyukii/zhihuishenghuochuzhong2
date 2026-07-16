import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import n16r8_cloud_relay as relay


class CloudRelayContractTests(unittest.TestCase):
    def test_identity_and_topic_prefix_are_project_scoped(self):
        self.assertEqual(relay.PROJECT_ID, "smartlife-junior-context")
        self.assertEqual(relay.PROFILE_ID, "smartlife-junior-context-detective-v1")
        self.assertEqual(relay.BASE_TOPIC, "smartlife/context-detective/n16r8")
        self.assertIn(f"{relay.BASE_TOPIC}/telemetry", relay.mqtt_topics_to_subscribe())
        self.assertIn(f"{relay.BASE_TOPIC}/command", relay.mqtt_topics_to_subscribe())

    def test_foreign_missing_profile_and_unknown_types_are_rejected(self):
        valid = {"type": "telemetry", "project": relay.PROJECT_ID, "profileId": relay.PROFILE_ID}
        self.assertTrue(relay.valid_board_frame(valid))
        self.assertFalse(relay.valid_board_frame({**valid, "project": "smartlife-junior"}))
        missing = valid.copy()
        missing.pop("profileId")
        self.assertFalse(relay.valid_board_frame(missing))
        self.assertFalse(relay.valid_board_frame({**valid, "type": "mystery"}))

    def test_board_frames_and_commands_use_separate_mqtt_routes(self):
        board = {
            "type": "telemetry",
            "project": relay.PROJECT_ID,
            "profileId": relay.PROFILE_ID,
            "origin": "web-serial-gateway",
            "originClientId": "usb-1",
        }
        topic, message, retain = relay.publish_route_for_client_message(json.dumps(board))
        self.assertEqual(topic, f"{relay.BASE_TOPIC}/telemetry")
        self.assertTrue(retain)
        self.assertEqual(json.loads(message)["originClientId"], "usb-1")

        command = {
            "type": "command",
            "project": relay.PROJECT_ID,
            "profileId": relay.PROFILE_ID,
            "id": "remote-1",
            "mode": "rest",
            "originClientId": "remote-browser",
        }
        topic, message, retain = relay.publish_route_for_client_message(json.dumps(command))
        self.assertEqual(topic, f"{relay.BASE_TOPIC}/command")
        self.assertFalse(retain)
        self.assertEqual(json.loads(message)["id"], "remote-1")

    def test_ack_is_not_retained_and_command_cannot_claim_usb_write(self):
        ack = {
            "type": "ack",
            "project": relay.PROJECT_ID,
            "profileId": relay.PROFILE_ID,
            "id": "remote-1",
            "ok": True,
            "origin": "web-serial-gateway",
            "originClientId": "usb-1",
        }
        self.assertFalse(relay.publish_route_for_client_message(json.dumps(ack))[2])
        command = {
            "type": "command",
            "project": relay.PROJECT_ID,
            "profileId": relay.PROFILE_ID,
            "id": "bad-1",
            "mode": "rest",
            "usbWritten": True,
        }
        self.assertIsNone(relay.publish_route_for_client_message(json.dumps(command)))

    def test_broadcast_strips_relay_private_metadata_but_keeps_client_origin(self):
        payload = {
            "type": "telemetry",
            "project": relay.PROJECT_ID,
            "profileId": relay.PROFILE_ID,
            "originClientId": "usb-1",
            "_relayId": "private",
        }
        outgoing = relay.broadcast_payload(payload)
        self.assertEqual(outgoing["originClientId"], "usb-1")
        self.assertNotIn("_relayId", outgoing)

    def test_origin_policy_is_exact(self):
        allowed = {"https://context.example", "http://127.0.0.1:18767"}
        self.assertTrue(relay.origin_allowed("https://context.example", allowed))
        self.assertFalse(relay.origin_allowed("https://evil.example", allowed))
        self.assertFalse(relay.origin_allowed("", allowed))

    def test_paho_reason_code_compatibility(self):
        class SuccessfulReason:
            is_failure = False

        class FailedReason:
            is_failure = True

        self.assertFalse(relay.reason_code_failed(SuccessfulReason()))
        self.assertTrue(relay.reason_code_failed(FailedReason()))
        self.assertFalse(relay.reason_code_failed(0))
        self.assertTrue(relay.reason_code_failed(5))

    def test_cli_defaults_bind_only_loopback_194xx(self):
        args = relay.build_parser().parse_args([])
        self.assertEqual(args.ws_host, "127.0.0.1")
        self.assertEqual(args.ws_port, 19466)
        self.assertEqual(args.mqtt_host, "127.0.0.1")
        self.assertEqual(args.mqtt_port, 19483)


if __name__ == "__main__":
    unittest.main()
