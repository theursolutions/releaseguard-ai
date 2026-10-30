# SECURITY STANDARD

Use secure-by-default implementation.

Follow OWASP principles.

Check:

* authentication
* authorization
* input validation
* output encoding
* SQL injection
* XSS
* CSRF
* mass assignment
* IDOR
* privilege escalation
* SSRF
* command injection
* file upload vulnerabilities
* sensitive data exposure
* insecure logging
* secret leakage

Never place:

* passwords
* API keys
* tokens
* credentials
* private keys

inside source code.

Never log secrets.

Never bypass authentication or authorization simply to make functionality work.

Security findings affecting the requested feature must be resolved before completion unless explicitly accepted by the user.
