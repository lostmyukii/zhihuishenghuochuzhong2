import base64
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import voice_transcribe_server as server


class VoiceTranscribeServerTests(unittest.TestCase):
    def test_identity_and_provider_detection_are_project_scoped(self):
        self.assertEqual(server.PROJECT_ID, "smartlife-junior-context")
        self.assertEqual(server.PROFILE_ID, "smartlife-junior-context-detective-v1")
        env = {
            "XFYUN_APP_ID": "appid",
            "XFYUN_API_KEY": "key",
            "XFYUN_API_SECRET": "secret",
        }
        self.assertEqual(server.env_provider(env), "xunfei")
        self.assertTrue(server.provider_configured("xunfei", env))
        self.assertEqual(server.intent_provider(env), "xunfei-spark-ws")
        self.assertTrue(server.intent_provider_configured("xunfei-spark-ws", env))

    def test_partial_credentials_never_report_configured(self):
        env = {"XFYUN_APP_ID": "appid", "XFYUN_API_KEY": "key"}
        self.assertEqual(server.env_provider(env), "disabled")
        self.assertFalse(server.provider_configured("xunfei", env))
        self.assertFalse(server.intent_provider_configured("xunfei-spark-ws", env))

    def test_health_payload_has_no_secret_material(self):
        env = {
            "VOICE_TRANSCRIBE_PROVIDER": "xunfei",
            "VOICE_INTENT_PROVIDER": "xunfei-spark-ws",
            "XFYUN_APP_ID": "private-app",
            "XFYUN_API_KEY": "private-key",
            "XFYUN_API_SECRET": "private-secret",
        }
        payload = server.health_payload(env, ffmpeg_available=True)
        encoded = json.dumps(payload, ensure_ascii=False)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["service"], "smartlife-context-voice")
        self.assertNotIn("private-app", encoded)
        self.assertNotIn("private-key", encoded)
        self.assertNotIn("private-secret", encoded)
        self.assertNotIn("authorization", encoded.lower())

    def test_xunfei_auth_urls_use_exact_hosts_and_paths(self):
        iat = server.xunfei_auth_url("key", "secret", host="iat-api.xfyun.cn", path="/v2/iat")
        spark = server.xunfei_auth_url("key", "secret", host="spark-api.xf-yun.com", path="/v4.0/chat")
        self.assertTrue(iat.startswith("wss://iat-api.xfyun.cn/v2/iat?"))
        self.assertTrue(spark.startswith("wss://spark-api.xf-yun.com/v4.0/chat?"))
        self.assertIn("authorization=", spark)
        self.assertIn("host=spark-api.xf-yun.com", spark)

    def test_xunfei_word_decoders_support_iat_results(self):
        words = {"ws": [{"cw": [{"w": "进入"}]}, {"cw": [{"w": "通风"}]}]}
        encoded = base64.b64encode(json.dumps(words, ensure_ascii=False).encode()).decode()
        self.assertEqual(server.xunfei_words_from_result(encoded), "进入通风")
        self.assertEqual(server.xunfei_words_from_legacy_result(words), "进入通风")

    def test_rules_cover_context_queries_modes_and_safety(self):
        cases = [
            ("现在最可能是什么情境", "queryContext", None),
            ("为什么判断为学习，有什么反向证据", "explainContext", None),
            ("我要专心写作业", "setMode", "study"),
            ("安静休息一会", "setMode", "rest"),
            ("屋里有点闷，帮我通风", "setMode", "ventilation"),
            ("现在没人，进入节能", "setMode", "energy"),
            ("返回实时侦测", "setMode", "detect"),
            ("当前有没有安全异常", "querySafety", None),
            ("把蜂鸣器静音", "muteBuzzer", None),
        ]
        for text, expected_intent, expected_mode in cases:
            with self.subTest(text=text):
                result = server.resolve_voice_intent(text, env={"VOICE_INTENT_PROVIDER": "rules"})
                self.assertEqual(result["intent"], expected_intent)
                if expected_mode:
                    self.assertEqual(result["mode"], expected_mode)

    def test_rules_cover_confirmation_correction_and_threshold_with_context(self):
        context = {"candidate": "study", "thresholds": {"soundThreshold": 600}}
        confirmed = server.resolve_voice_intent("确认当前判断", context, {"VOICE_INTENT_PROVIDER": "rules"})
        corrected = server.resolve_voice_intent("这次判断不正确，应该是安静休息", context, {"VOICE_INTENT_PROVIDER": "rules"})
        threshold = server.resolve_voice_intent("把声音阈值调高一点", context, {"VOICE_INTENT_PROVIDER": "rules"})
        self.assertEqual(confirmed["intent"], "confirmContext")
        self.assertEqual(confirmed["candidate"], "study")
        self.assertEqual(corrected["intent"], "correctContext")
        self.assertEqual(corrected["mode"], "rest")
        self.assertEqual(threshold["intent"], "setThreshold")
        self.assertEqual(threshold["settings"], {"soundThreshold": 650})

    def test_unknown_text_does_not_force_a_control_action(self):
        result = server.resolve_voice_intent("给我讲一个很长的故事", env={"VOICE_INTENT_PROVIDER": "rules"})
        self.assertEqual(result["intent"], "unknown")
        self.assertLessEqual(result["confidence"], 0.35)

    def test_sanitizer_rejects_modes_hardware_and_mixed_thresholds(self):
        invalid = [
            {"intent": "setMode", "mode": "party", "confidence": 0.99},
            {"intent": "setFan", "fan": 100, "confidence": 0.99},
            {"intent": "gpio", "pin": 12, "value": 1, "confidence": 0.99},
            {"intent": "setThreshold", "settings": {"soundThreshold": 500, "lightThreshold": 300}, "confidence": 0.99},
            {"intent": "setThreshold", "settings": {"temperatureThreshold": 80}, "confidence": 0.99},
            {"intent": "setThreshold", "settings": {"mq2Threshold": 3000}, "confidence": 0.99},
        ]
        for candidate in invalid:
            with self.subTest(candidate=candidate):
                result = server.sanitize_voice_intent(candidate, "test", "mock", "mock")
                self.assertEqual(result["intent"], "unknown")

    def test_low_confidence_control_becomes_unknown_but_queries_remain_read_only(self):
        control = server.sanitize_voice_intent(
            {"intent": "setMode", "mode": "study", "confidence": 0.4}, "可能学习", "mock", "mock"
        )
        query = server.sanitize_voice_intent(
            {"intent": "querySafety", "confidence": 0.4}, "安全吗", "mock", "mock"
        )
        self.assertEqual(control["intent"], "unknown")
        self.assertEqual(query["intent"], "querySafety")

    def test_extract_first_json_object_from_markdownish_text(self):
        payload = server.extract_first_json_object(
            '结果如下：```json\n{"intent":"setMode","mode":"energy","confidence":0.8}\n```'
        )
        self.assertEqual(payload["intent"], "setMode")
        self.assertEqual(payload["mode"], "energy")

    def test_spark_request_is_ultra_and_contains_only_bounded_context(self):
        request = server.build_spark_request(
            "appid",
            "为什么这样判断",
            {"mode": "detect", "sensors": {"light": 123}, "ignored": "x" * 2000},
        )
        self.assertEqual(request["parameter"]["chat"]["domain"], "4.0Ultra")
        self.assertLessEqual(request["parameter"]["chat"]["max_tokens"], 512)
        messages = request["payload"]["message"]["text"]
        self.assertEqual(messages[0]["role"], "system")
        self.assertIn("白名单", messages[0]["content"])
        self.assertNotIn("ignored", messages[-1]["content"])

    def test_mock_transcription_and_intent_do_not_need_network(self):
        transcription = server.transcribe_audio(
            b"fake",
            "speech.webm",
            "audio/webm",
            env={"VOICE_TRANSCRIBE_PROVIDER": "mock", "VOICE_TRANSCRIBE_MOCK_TEXT": "进入通风"},
        )
        intent = server.resolve_voice_intent(
            transcription["text"],
            env={
                "VOICE_INTENT_PROVIDER": "mock",
                "VOICE_INTENT_MOCK_JSON": '{"intent":"setMode","mode":"ventilation","confidence":0.98}',
            },
        )
        self.assertEqual(transcription["provider"], "mock")
        self.assertEqual(intent["mode"], "ventilation")

    def test_origin_policy_is_exact_and_local_development_is_explicit(self):
        env = {"VOICE_ALLOWED_ORIGINS": "https://context.example.test,http://127.0.0.1:18767"}
        self.assertTrue(server.origin_allowed("https://context.example.test", env))
        self.assertTrue(server.origin_allowed("http://127.0.0.1:18767", env))
        self.assertFalse(server.origin_allowed("https://evil.example", env))
        self.assertFalse(server.origin_allowed("", env))


if __name__ == "__main__":
    unittest.main()
