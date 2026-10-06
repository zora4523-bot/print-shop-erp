import { describe, expect, it } from 'vitest';
import { isBundleSourceAddressValid, isMockMode } from '../zip';

const configuredEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  OSS_ACCESS_KEY_ID: 'config-validation-key',
  OSS_ACCESS_KEY_SECRET: 'config-validation-secret',
  OSS_STS_ROLE_ARN: 'acs:ram::111:role/uploader',
  OSS_BUCKET: 'config-validation',
  OSS_REGION: 'oss-cn-shenzhen',
};

describe('CDR 配置校验', () => {
  it.each([
    [undefined, true],
    ['true', true],
    ['false', false],
  ] as const)('非法 endpoint 时模式 %s 返回 %s，地址校验失败', (mode, expected) => {
    const env: NodeJS.ProcessEnv = {
      ...configuredEnv,
      NODE_ENV: 'production',
      CDR_BUNDLE_MOCK_MODE: mode,
      OSS_ENDPOINT: 'invalid endpoint',
    };
    expect(isMockMode(env)).toBe(expected);
    expect(isBundleSourceAddressValid('https://example.com/design/a.cdr', env)).toBe(false);
  });

  it('读取明确指定的模式', () => {
    expect(isMockMode({ NODE_ENV: 'test', CDR_BUNDLE_MOCK_MODE: 'true' })).toBe(true);
    expect(isMockMode({ ...configuredEnv, CDR_BUNDLE_MOCK_MODE: 'false' })).toBe(false);
  });

  it('识别未完成的配置', () => {
    expect(isMockMode({
      NODE_ENV: 'test',
      OSS_ACCESS_KEY_ID: 'config-validation-key',
      OSS_ACCESS_KEY_SECRET: 'config-validation-secret',
      OSS_BUCKET: 'config-validation',
      OSS_REGION: 'oss-cn-shenzhen',
    })).toBe(true);
  });

  it('依据运行环境读取默认模式', () => {
    expect(isMockMode({ ...configuredEnv, NODE_ENV: 'development' })).toBe(true);
    expect(isMockMode({ ...configuredEnv, NODE_ENV: 'production' })).toBe(false);
  });

  it('使用配置校验设计文件地址', () => {
    expect(isBundleSourceAddressValid('https://example.com/design/a.cdr', configuredEnv)).toBe(true);
    expect(isBundleSourceAddressValid('invalid address', configuredEnv)).toBe(false);
    expect(isBundleSourceAddressValid('https://example.com/salary/a.csv', configuredEnv)).toBe(false);
  });
});
