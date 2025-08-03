# Contributing to Seekr

Thank you for your interest in contributing to Seekr! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Git

### Setting up the development environment

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/seekr-app.git
   cd seekr-app
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## 🛠️ Development Workflow

### Branch Naming

- `feature/description` - for new features
- `fix/description` - for bug fixes
- `docs/description` - for documentation updates
- `refactor/description` - for code refactoring

### Making Changes

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Test your changes thoroughly
4. Commit your changes with a descriptive message:
   ```bash
   git commit -m "feat: add new search filter option"
   ```
5. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
6. Create a Pull Request

### Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` - new features
- `fix:` - bug fixes
- `docs:` - documentation changes
- `style:` - formatting, missing semicolons, etc.
- `refactor:` - code refactoring
- `test:` - adding or updating tests
- `chore:` - maintenance tasks

## 🧪 Testing

Before submitting a PR, please ensure:

1. The application builds successfully:
   ```bash
   npm run build
   ```
2. Linting passes:
   ```bash
   npm run lint
   ```
3. All existing functionality still works
4. New features are tested manually

## 📝 Code Style

- Use TypeScript for all new code
- Follow the existing code style and formatting
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

## 🐛 Reporting Bugs

When reporting bugs, please include:

1. **Description**: Clear description of the issue
2. **Steps to Reproduce**: Detailed steps to reproduce the bug
3. **Expected Behavior**: What you expected to happen
4. **Actual Behavior**: What actually happened
5. **Environment**: OS, Node.js version, app version
6. **Screenshots**: If applicable

## 💡 Suggesting Features

When suggesting new features:

1. Check if the feature already exists or is planned
2. Describe the feature and its use case
3. Explain why it would be valuable
4. Consider implementation complexity
5. Be open to discussion and feedback

## 📋 Pull Request Guidelines

### Before Submitting

- [ ] Code follows the project's style guidelines
- [ ] Self-review of the code has been performed
- [ ] Code is commented, particularly in hard-to-understand areas
- [ ] Changes have been tested locally
- [ ] No new warnings or errors are introduced

### PR Description

Please include:

1. **Summary**: Brief description of changes
2. **Type of Change**: Bug fix, new feature, breaking change, etc.
3. **Testing**: How the changes were tested
4. **Screenshots**: If UI changes are involved
5. **Related Issues**: Link to related issues

### Review Process

1. PRs require at least one review from a maintainer
2. All CI checks must pass
3. Address any feedback from reviewers
4. Maintainers will merge approved PRs

## 🏗️ Project Structure

```
seekr/
├── src/                    # React frontend
├── components/         # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility functions

│   └── assets/            # Static assets
├── electron/              # Electron main process
│   ├── main.ts            # Main process entry point
│   ├── preload.ts         # Preload script for IPC
│   └── services/          # Backend services
├── public/                # Public assets
└── dist/                  # Build output
```

## 🤝 Community

- Be respectful and inclusive
- Help others learn and grow
- Share knowledge and best practices
- Provide constructive feedback

## 📞 Getting Help

If you need help:

1. Check the [README](README.md) and documentation
2. Search existing [issues](https://github.com/k6w/seekr/issues)
3. Ask in [Discussions](https://github.com/k6w/seekr/discussions)
4. Create a new issue if needed

Thank you for contributing to Seekr! 🎉
