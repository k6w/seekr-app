# Security Policy

## Supported Versions

We actively support the following versions of Seekr with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of Seekr seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them using one of the following methods:

1. **GitHub Security Advisories** (Preferred)
   - Go to https://github.com/k6w/seekr/security/advisories/new
   - Fill out the security advisory form
   - This allows us to work with you privately to fix the issue

2. **Email**
   - Send an email to the project maintainer
   - Include as much information as possible about the vulnerability

### What to Include

Please include the following information in your report:

- **Description**: A clear description of the vulnerability
- **Impact**: What could an attacker accomplish with this vulnerability?
- **Reproduction**: Step-by-step instructions to reproduce the issue
- **Environment**: Operating system, Seekr version, and any other relevant details
- **Proof of Concept**: If possible, include a minimal proof of concept

### Response Timeline

- **Initial Response**: We will acknowledge receipt of your vulnerability report within 48 hours
- **Investigation**: We will investigate and validate the vulnerability within 7 days
- **Fix Development**: We will work on a fix and keep you updated on progress
- **Disclosure**: We will coordinate with you on the disclosure timeline

### Security Update Process

1. **Validation**: We validate and reproduce the vulnerability
2. **Fix Development**: We develop and test a fix
3. **Security Advisory**: We prepare a security advisory
4. **Release**: We release a patched version
5. **Disclosure**: We publicly disclose the vulnerability after users have had time to update

## Security Best Practices

### For Users

- **Keep Updated**: Always use the latest version of Seekr
- **Download from Official Sources**: Only download Seekr from official GitHub releases
- **Verify Checksums**: Verify file integrity when possible
- **Report Issues**: Report any suspicious behavior immediately

### For Developers

- **Code Review**: All code changes require review
- **Dependency Updates**: We regularly update dependencies
- **Static Analysis**: We use automated tools to scan for vulnerabilities
- **Secure Coding**: We follow secure coding practices

## Known Security Considerations

### Local Data Storage
- Seekr stores file index data locally in SQLite databases
- No data is transmitted to external servers
- File paths and metadata are stored locally only

### File System Access
- Seekr requires file system read access to index files
- Users control which directories are indexed
- No files are modified, only read for indexing

### Electron Security
- We follow Electron security best practices
- Context isolation is enabled
- Node.js integration is disabled in renderer processes
- We regularly update Electron to the latest secure version

## Scope

This security policy applies to:
- The main Seekr application
- Official build scripts and configurations
- Documentation and examples in this repository

This policy does not cover:
- Third-party dependencies (report to their respective maintainers)
- User-generated content or configurations
- Issues in development or testing environments

## Recognition

We appreciate security researchers who help keep Seekr secure. With your permission, we will:
- Acknowledge your contribution in our security advisories
- Include you in our hall of fame (if you wish)
- Provide updates on the fix progress

## Questions

If you have questions about this security policy, please:
- Open a discussion on GitHub
- Contact the maintainers
- Check our documentation

Thank you for helping keep Seekr secure! 🔒
