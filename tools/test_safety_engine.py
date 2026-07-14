import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIRMWARE = ROOT / "firmware"


class SafetyEngineNativeTests(unittest.TestCase):
    def test_native_safety_engine_behavior(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            binary = Path(temp_dir) / "safety_engine_test"
            compile_result = subprocess.run(
                [
                    "c++",
                    "-std=c++17",
                    "-Wall",
                    "-Wextra",
                    "-Werror",
                    f"-I{FIRMWARE / 'include'}",
                    str(FIRMWARE / "src" / "safety_engine.cpp"),
                    str(FIRMWARE / "native_tests" / "safety_engine_test.cpp"),
                    "-o",
                    str(binary),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(compile_result.returncode, 0, compile_result.stderr)
            run_result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(run_result.returncode, 0, run_result.stderr or run_result.stdout)


if __name__ == "__main__":
    unittest.main()
