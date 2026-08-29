import { describe, expect, it } from 'vitest';

import * as connect from './index';
import * as react from './react';
import * as hosted from './hosted';

describe('Connect 0.29 public surface', () => {
  it('exports the canonical identity transition and control contract', () => {
    expect(connect).toHaveProperty('connectDexterIdentity');
    expect(connect).toHaveProperty('disconnectDexterIdentity');
    expect(connect).toHaveProperty('createDexterControlModel');
    expect(react).toHaveProperty('useDexterConnection');
    expect(react).toHaveProperty('REMOVE_DEXTER_FROM_DEVICE_CONFIRMATION');
  });

  it('keeps the browser roster and partial-session controls private', () => {
    for (const name of [
      'getActiveHandle',
      'getActiveWallet',
      'setActiveHandle',
      'setActiveWallet',
      'listWallets',
      'switchWallet',
      'forgetWallet',
      'disconnectActiveWallet',
      'ejectActiveWallet',
      'removeWalletFromDeviceRoster',
      'passkeyLogin',
      'continueWithDexter',
    ]) {
      expect(connect).not.toHaveProperty(name);
    }

    for (const name of [
      'useDexterWallet',
      'useDexterIdentity',
      'useIdentity',
      'useSignInWithDexter',
      'SignInWithDexter',
      'DexterWalletChip',
      'DexterWalletMenu',
      'createDexterIdentityCoordinator',
      'createWalletProofSessionStore',
      'walletProofSessionStore',
    ]) {
      expect(react).not.toHaveProperty(name);
    }
  });

  it('exposes one origin-guarded hosted ceremony entry', () => {
    expect(hosted).toHaveProperty('runHostedCeremony');
    expect(hosted).toHaveProperty('DEXTER_HOSTED_CEREMONY_ORIGIN');
    expect(hosted).not.toHaveProperty('passkeyLogin');
    expect(hosted).not.toHaveProperty('continueWithDexter');
    expect(hosted).not.toHaveProperty('listWallets');
    expect(connect).not.toHaveProperty('runHostedCeremony');
  });
});
