from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"


class DeployContractTests(unittest.TestCase):
    def test_independent_service_names_and_directory(self):
        expected = {
            "smartlife-context-web.service",
            "smartlife-context-relay.service",
            "smartlife-context-voice.service",
            "smartlife-context-mqtt.service",
        }
        self.assertEqual({path.name for path in DEPLOY.glob("*.service")}, expected)
        for name in expected:
            text = (DEPLOY / name).read_text()
            self.assertIn("/home/ubuntu/smartlife-context-detective", text)
            self.assertNotIn("/home/ubuntu/smartlife-junior/", text)
            self.assertNotIn("/home/ubuntu/smartlife-primary/", text)

    def test_194xx_services_bind_loopback(self):
        combined = "\n".join(path.read_text() for path in DEPLOY.iterdir() if path.is_file())
        for port in (19466, 19467, 19468, 19483):
            self.assertIn(str(port), combined)
        self.assertIn("127.0.0.1", combined)
        for old_port in (19166, 19167, 19168, 19183, 19266, 19267, 19283, 19366, 19367, 19383):
            self.assertNotIn(str(old_port), combined)

    def test_env_example_has_no_live_secrets(self):
        text = (DEPLOY / ".env.example").read_text()
        values = dict(
            line.split("=", 1)
            for line in text.splitlines()
            if line and not line.startswith("#") and "=" in line
        )
        for key in ("XFYUN_APP_ID", "XFYUN_API_KEY", "XFYUN_API_SECRET"):
            self.assertIn(key, values)
            self.assertEqual(values[key], "")

    def test_mqtt_is_loopback_only_and_not_public_anonymous(self):
        text = (DEPLOY / "mosquitto-context.conf").read_text()
        self.assertIn("listener 19483 127.0.0.1", text)
        self.assertNotIn("listener 19483 0.0.0.0", text)

    def test_nginx_templates_use_only_context_ports_and_placeholders(self):
        http = (DEPLOY / "nginx-context-http.conf.template").read_text()
        https = (DEPLOY / "nginx-context-https.conf.template").read_text()
        self.assertIn("__DOMAIN__", http)
        self.assertIn("__DOMAIN__", https)
        self.assertIn("127.0.0.1:19467", https)
        self.assertIn("127.0.0.1:19466", https)
        self.assertIn("127.0.0.1:19468", https)
        self.assertIn("X-Forwarded-For $proxy_add_x_forwarded_for", https)
        self.assertNotIn("zhinengshenghuo.ilelezhan.cn", http + https)


if __name__ == "__main__":
    unittest.main()
