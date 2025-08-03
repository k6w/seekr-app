#!/usr/bin/env node

/**
 * Test script to verify the build process works correctly
 * This script can be run locally to test the build before pushing to CI
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔧 Testing Seekr build process...\n');

// Check if we're in the right directory
if (!fs.existsSync('package.json')) {
  console.error('❌ Error: package.json not found. Please run this script from the project root.');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (packageJson.name !== 'seekr') {
  console.error('❌ Error: This doesn\'t appear to be the Seekr project.');
  process.exit(1);
}

console.log('✅ Project validation passed');

// Test steps
const steps = [
  {
    name: 'Install dependencies',
    command: 'npm ci',
    description: 'Installing project dependencies...'
  },
  {
    name: 'Rebuild native dependencies',
    command: 'npm run postinstall',
    description: 'Rebuilding native dependencies for Electron...'
  },
  {
    name: 'Lint code',
    command: 'npm run lint',
    description: 'Running ESLint...'
  },
  {
    name: 'Type check',
    command: 'npm run tsc',
    description: 'Running TypeScript compiler...'
  },
  {
    name: 'Build application',
    command: process.platform === 'win32' ? 'npm run build:win' : 
             process.platform === 'darwin' ? 'npm run build:mac' : 
             'npm run build:linux',
    description: `Building application for ${process.platform}...`
  }
];

let currentStep = 0;

for (const step of steps) {
  currentStep++;
  console.log(`\n📦 Step ${currentStep}/${steps.length}: ${step.name}`);
  console.log(`   ${step.description}`);
  
  try {
    execSync(step.command, { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    console.log(`✅ ${step.name} completed successfully`);
  } catch (error) {
    console.error(`❌ ${step.name} failed:`);
    console.error(error.message);
    process.exit(1);
  }
}

// Check build output
console.log('\n🔍 Checking build output...');

const releaseDir = 'release';
if (fs.existsSync(releaseDir)) {
  const files = fs.readdirSync(releaseDir, { recursive: true });
  const buildArtifacts = files.filter(file =>
    file.endsWith('.exe') ||
    file.endsWith('.dmg') ||
    file.endsWith('.AppImage')
  );

  // Check for specific Windows artifacts
  const hasInstaller = buildArtifacts.some(file => file.includes('Setup.exe'));
  const hasPortable = buildArtifacts.some(file => file.includes('Portable.exe'));

  if (process.platform === 'win32') {
    if (hasInstaller && hasPortable) {
      console.log('✅ Both Windows installer and portable versions found');
    } else if (hasInstaller) {
      console.log('⚠️  Only Windows installer found (portable version missing)');
    } else if (hasPortable) {
      console.log('⚠️  Only Windows portable found (installer version missing)');
    }
  }
  
  if (buildArtifacts.length > 0) {
    console.log('✅ Build artifacts found:');
    buildArtifacts.forEach(artifact => {
      const fullPath = path.join(releaseDir, artifact);
      const stats = fs.statSync(fullPath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`   📄 ${artifact} (${sizeInMB} MB)`);
    });
  } else {
    console.log('⚠️  No build artifacts found in release directory');
  }
} else {
  console.log('⚠️  Release directory not found');
}

console.log('\n🎉 Build test completed successfully!');
console.log('\n💡 Tips:');
console.log('   - Run this script before pushing to CI to catch issues early');
console.log('   - Check the release/ directory for your built application');
console.log('   - Test the built application to ensure it works correctly');
