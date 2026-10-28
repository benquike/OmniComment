import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicomment-e2e-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const extensionsDir = path.join(tempRoot, 'extensions');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  try {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to test runner
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // If "Markdown Editor" (cweijan.vscode-office) is installed locally, symlink it into the
    // isolated test extensions directory so E2E tests can verify commenting inside it too.
    const userExtRoot = path.join(os.homedir(), '.vscode', 'extensions');
    if (fs.existsSync(userExtRoot)) {
      const entries = fs.readdirSync(userExtRoot);
      const officeExt = entries
        .filter(e => e.startsWith('cweijan.vscode-office-'))
        .sort()
        .pop();
      if (officeExt) {
        fs.symlinkSync(
          path.join(userExtRoot, officeExt),
          path.join(extensionsDir, officeExt),
          'dir'
        );
      }
    }

    const localVsCodeExecutable = '/usr/share/code/code';
    const vscodeExecutablePath = fs.existsSync(localVsCodeExecutable)
      ? localVsCodeExecutable
      : undefined;

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust'
      ]
    });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

main();
