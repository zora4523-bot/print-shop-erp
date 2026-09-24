import { describe, expect, it } from 'vitest';
import { objectKeyFromReadUrl } from '../object-key';

const bucketUrl = 'https://my-bucket.oss-cn-shenzhen.aliyuncs.com';
const key = 'design/o1/i1/cdr-1.cdr';
const derive = (fileUrl: string, publicBaseUrl: string) =>
  objectKeyFromReadUrl(new URL(fileUrl), { publicBaseUrl, bucketUrl });

describe('objectKeyFromReadUrl', () => {
  it('读取域不带路径：整段 pathname 即 key', () => {
    expect(derive(`${bucketUrl}/${key}`, bucketUrl)).toBe(key);
    expect(derive(`https://cdn.example.com/${key}`, 'https://cdn.example.com')).toBe(key);
  });

  it('读取域带路径前缀（含末尾斜杠、登记时拼出的双斜杠）：剥掉前缀', () => {
    const base = 'https://cdn.example.com/assets';
    expect(derive(`${base}/${key}`, base)).toBe(key);
    expect(derive(`${base}/${key}`, `${base}/`)).toBe(key);
    expect(derive(`${base}//${key}`, `${base}/`)).toBe(key);
  });

  it('同 host 但不在前缀下时退回 bucketUrl 匹配；都不匹配返回 null', () => {
    const base = 'https://cdn.example.com/assets';
    expect(derive(`${bucketUrl}/${key}`, base)).toBe(key);
    expect(derive(`https://cdn.example.com/other/${key}`, base)).toBeNull();
    expect(derive(`https://elsewhere.example.com/${key}`, base)).toBeNull();
  });

  it('解码百分号编码的路径；不合法的读取域配置被跳过', () => {
    expect(derive(`${bucketUrl}/design/o1/i1/%E7%BA%A2%E5%8C%85.cdr`, 'not a url')).toBe(
      'design/o1/i1/红包.cdr',
    );
  });

  it('读取域路径前缀含百分号编码或中文时同样剥掉前缀，再解码剩余 key', () => {
    for (const base of [
      'https://cdn.example.com/assets%20v1',
      'https://cdn.example.com/资源/设计',
      'https://cdn.example.com/%E8%B5%84%E6%BA%90',
    ]) {
      expect(derive(`${base}/${key}`, base), base).toBe(key);
      expect(derive(`${base}/design/o1/i1/红包 副本.cdr`, `${base}/`), base).toBe(
        'design/o1/i1/红包 副本.cdr',
      );
    }
    // 大小写不同的百分号编码视为同一前缀；不在前缀下仍返回 null。
    expect(derive(`https://cdn.example.com/a%2fb/${key}`, 'https://cdn.example.com/a%2Fb')).toBe(key);
    expect(
      derive(`https://cdn.example.com/assets%20v2/${key}`, 'https://cdn.example.com/assets%20v1'),
    ).toBeNull();
  });
});
