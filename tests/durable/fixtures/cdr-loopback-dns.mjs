// Loaded only by playwright.cdr.config.ts. Route the OSS SDK's virtual bucket
// hostname to the test HTTP fixture without relying on public wildcard DNS.
import dns from 'node:dns';
const lookup = dns.lookup;
dns.lookup = function (hostname, ...args) {
  return lookup.call(this, hostname === 'cdr-test.localhost' ? '127.0.0.1' : hostname, ...args);
};
