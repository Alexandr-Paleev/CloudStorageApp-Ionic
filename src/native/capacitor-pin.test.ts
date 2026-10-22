import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The iOS project does not read Capacitor from node_modules. Its native code
 * comes from the Swift package capacitor-swift-pm, pinned to an exact version
 * in Package.swift, and only the Capacitor CLI writes that line, with the
 * version of the @capacitor/ios it finds installed. Dependabot moves
 * @capacitor/ios in package.json and the lock file and runs no CLI, so after
 * its Capacitor group the pin stays where it was: 4.11.1 found it at 8.5.1
 * under 8.5.3, and an iOS build would have run the JavaScript of one version
 * on the native code of the other. Android reads Capacitor from node_modules
 * and cannot fall behind.
 *
 * Both files are read from the repository's root, where the tests run: under
 * jsdom a module's own address is not a file's.
 */
const PACKAGE_SWIFT = 'ios/App/CapApp-SPM/Package.swift';

function pinnedNativeVersion(): string | undefined {
  const manifest = readFileSync(resolve(PACKAGE_SWIFT), 'utf8');
  return /capacitor-swift-pm\.git",\s*exact:\s*"([^"]+)"/.exec(manifest)?.[1];
}

function installedCapacitorIos(): string | undefined {
  const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };
  return lock.packages['node_modules/@capacitor/ios']?.version;
}

describe('the iOS project', () => {
  it("pins Capacitor's native code to the @capacitor/ios the lock file installs", () => {
    const installed = installedCapacitorIos();
    expect(installed, '@capacitor/ios is not in package-lock.json').toBeDefined();
    expect(
      pinnedNativeVersion(),
      `${PACKAGE_SWIFT} pins capacitor-swift-pm to another version than ${installed}, the @capacitor/ios in package-lock.json. \`npx cap update ios\` writes the line`
    ).toBe(installed);
  });
});
