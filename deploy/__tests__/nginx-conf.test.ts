import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// CI 里没有 nginx，CLAUDE.md 也明确不引入 Docker，所以这里做的是**文本结构契约**
// 断言，不是 nginx 语义校验。它挡不住语法错误（那要靠部署时的 `nginx -t`），
// 但能挡住「有人把登录限流改回只挂 callback URL」这类回归——那次回归的代价是
// 登录爆破完全无限流，而且从外部看不出任何异常（全是 200）。
const conf = readFileSync(
  path.join(process.cwd(), 'deploy', 'nginx.conf.example'),
  'utf8',
);

// 80 端口那个 server 里也有一个 `location / {`（只 return 301）。断言必须落在
// HTTPS server 上，否则 `location /` 的 proxy_set_header 检查会命中那个空壳块。
const httpsServer = conf.slice(conf.indexOf('listen 443'));

/**
 * 截取一个 location 块的块体。文件内的 location 块没有嵌套花括号，
 * 所以「下一处 4 空格缩进的 `}`」就是块尾。
 */
function locationBody(header: string): string {
  const start = httpsServer.indexOf(header);
  if (start < 0) {
    throw new Error(`nginx.conf.example 里找不到 ${header}`);
  }
  const end = httpsServer.indexOf('\n    }', start);
  if (end < 0) {
    throw new Error(`${header} 的块体没有以 4 空格缩进的 } 收尾`);
  }
  return httpsServer.slice(start, end);
}

// 漏任何一行都会静默出错：Host / X-Forwarded-Host 决定二维码与外协短链的域名，
// X-Forwarded-Proto 决定登录 cookie 的 Secure 标志与 base URL 会不会退化成
// localhost 死链。对齐空格数可以变，行本身不能少。
const PROXY_FORWARD_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Host', '$host'],
  ['X-Forwarded-Host', '$host'],
  ['X-Forwarded-Proto', '$scheme'],
  ['X-Forwarded-For', '$proxy_add_x_forwarded_for'],
  ['X-Real-IP', '$remote_addr'],
];

function proxyHeaderPattern(name: string, value: string): RegExp {
  const escaped = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `proxy_set_header\\s+${escaped(name)}\\s+${escaped(value)};`,
  );
}

describe('nginx.conf.example 登录限流契约', () => {
  it('把 erp_auth 限流挂在 /login —— 浏览器真正 POST 凭据的那个路径', () => {
    // 登录走 Server Action，<form action=""> 即当前 URL，凭据 POST 回 /login 本身。
    // 只挂 callback URL 等于没挂：浏览器一次都不会访问它。
    const login = locationBody('location = /login {');

    expect(login).toMatch(/limit_req\s+zone=erp_auth\s+burst=5\s+nodelay;/);
    expect(login).toMatch(/limit_req_status\s+429;/);
  });

  it('用 map $request_method 生成限流 key，让 GET /login 完全豁免', () => {
    const mapStart = conf.indexOf('map $request_method $erp_auth_limit_key');
    expect(mapStart).toBeGreaterThan(-1);

    const mapEnd = conf.indexOf('\n}', mapStart);
    expect(mapEnd).toBeGreaterThan(mapStart);
    const mapBody = conf.slice(mapStart, mapEnd);

    // 空 key 的请求不计数（nginx 官方语义），于是 GET / RSC 预取不受限流影响。
    expect(mapBody).toMatch(/default\s+"";/);
    expect(mapBody).toMatch(/POST\s+\$binary_remote_addr;/);

    expect(conf).toMatch(
      /limit_req_zone\s+\$erp_auth_limit_key\s+zone=erp_auth:10m\s+rate=10r\/m;/,
    );

    // 防止有人把 map 撤回去：那样 GET /login 会重新计数，未登录用户被
    // layout redirect 到登录页点几下就会看到登录页自己返回 429，无法自救。
    expect(conf).not.toMatch(
      /limit_req_zone\s+\$binary_remote_addr\s+zone=erp_auth/,
    );

    // erp_heavy 不受本次改动影响，仍按客户端 IP 限流（PDF 的 GET 也要限）。
    expect(conf).toMatch(
      /limit_req_zone\s+\$binary_remote_addr\s+zone=erp_heavy:10m\s+rate=10r\/m;/,
    );
  });

  it('保留 callback 块做纵深防御，并与 /login 共用同一个令牌桶', () => {
    // 该路由确实挂载在 app/api/auth/[...nextauth]/route.ts 上、可被脚本直接爆破。
    // 共用同一个桶：换条路径不该给攻击者一份新配额。
    const callback = locationBody('location = /api/auth/callback/credentials {');

    expect(callback).toMatch(/limit_req\s+zone=erp_auth\s+burst=5\s+nodelay;/);
    expect(callback).toMatch(/limit_req_status\s+429;/);
  });

  it.each([
    ['location = /login {'],
    ['location = /api/auth/callback/credentials {'],
    ['location / {'],
  ])('%s 转发全部 5 个反代头', (header) => {
    const body = locationBody(header);

    for (const [name, value] of PROXY_FORWARD_HEADERS) {
      expect(body).toMatch(proxyHeaderPattern(name, value));
    }
  });
});
