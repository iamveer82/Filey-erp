"""Regression for the claim-verification flaw found by the dependency audit."""
import time
import unittest

import jwt


class JwtOptionsTests(unittest.TestCase):
    def test_peek_does_not_disable_claim_checks_when_options_are_reused(self):
        key = "fictional-local-regression-key-32-characters"
        expired = jwt.encode({"exp": int(time.time()) - 3600, "sub": "fictional-test"}, key, algorithm="HS256")
        for decode in (jwt.decode, jwt.decode_complete):
            with self.subTest(method=decode.__name__):
                options = {"verify_signature": False}
                decode(expired, options=options)
                self.assertEqual(options, {"verify_signature": False})
                options["verify_signature"] = True
                with self.assertRaises(jwt.ExpiredSignatureError):
                    decode(expired, key, algorithms=["HS256"], options=options)


if __name__ == "__main__":
    unittest.main()
