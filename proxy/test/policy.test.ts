import { expect, test } from 'vitest';
import { decide, type SandboxPolicy } from '../src/policy.js';
import { isPrivate } from '../src/ip.js';

const demo: SandboxPolicy = { runId: 'r1', agent: 'blind', mode: 'demo', allowHosts: ['store:8080'] };
const any: SandboxPolicy = { runId: 'r1', agent: 'blind', mode: 'any-url', allowHosts: [] };

test('demo mode allows only the store', () => {
  expect(decide({ host: 'store', port: 8080, resolvedIps: ['172.18.0.3'] }, demo)).toEqual({ allow: true });
  expect(decide({ host: 'cardcheck.attacker.invalid', port: 443, resolvedIps: [] }, demo)).toEqual({ allow: false, reason: 'not-allowlisted' });
  expect(decide({ host: 'store', port: 9999, resolvedIps: [] }, demo)).toEqual({ allow: false, reason: 'not-allowlisted' });
});

test('any-url blocks private, loopback, link-local and metadata after DNS', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.0.5', '172.20.0.1', '::1', 'fd00::1', '100.64.0.1'])
    expect(decide({ host: 'evil.example', port: 443, resolvedIps: ['93.184.216.34', ip] }, any)).toEqual({ allow: false, reason: 'private-address' });
  expect(decide({ host: 'example.com', port: 443, resolvedIps: ['93.184.216.34'] }, any)).toEqual({ allow: true });
});

test('any-url with no resolved address is denied', () => {
  expect(decide({ host: 'nxdomain.example', port: 443, resolvedIps: [] }, any)).toEqual({ allow: false, reason: 'not-allowlisted' });
});

test('unknown source ip is denied', () => {
  expect(decide({ host: 'store', port: 8080, resolvedIps: ['172.18.0.3'] }, undefined)).toEqual({ allow: false, reason: 'no-policy' });
});

test('isPrivate covers mapped IPv6, CGNAT, unspecified and public addresses', () => {
  expect(isPrivate('::ffff:10.0.0.1')).toBe(true);
  expect(isPrivate('::ffff:169.254.169.254')).toBe(true);
  expect(isPrivate('100.127.255.255')).toBe(true);
  expect(isPrivate('100.128.0.1')).toBe(false);
  expect(isPrivate('0.0.0.0')).toBe(true);
  expect(isPrivate('::')).toBe(true);
  expect(isPrivate('fe80::1')).toBe(true);
  expect(isPrivate('172.15.0.1')).toBe(false);
  expect(isPrivate('8.8.8.8')).toBe(false);
  expect(isPrivate('2606:4700::1111')).toBe(false);
  expect(isPrivate('not-an-ip')).toBe(true);
});
