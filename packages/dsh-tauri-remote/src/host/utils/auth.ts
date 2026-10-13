import type { RemoteAuthFailureRecord, RemoteSessionTicket } from '../types/index'
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const AUTH_FAILURE_LIMIT = 5

const AUTH_BAN_MS = 5 * 60 * 1000

const SECRET_BYTES = 32

const LINK_TOKEN_LENGTH = 8

const LINK_TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

const SESSION_VERSION = 'v1'

export function signSession(secret: string, now: number, ttlMs = SESSION_TTL_MS): RemoteSessionTicket {
  const expiresAt = now + ttlMs
  return { value: `${SESSION_VERSION}.${now}.${expiresAt}.${signatureOf(secret, now, expiresAt)}`, issuedAt: now, expiresAt }
}

export function verifySession(value: string | undefined, secret: string, now: number): boolean {
  if (value === undefined || secret === '')
    return false
  const segments = value.split('.')
  const version = segments[0]
  const issuedAt = Number(segments[1])
  const expiresAt = Number(segments[2])
  const mac = segments[3]
  if (segments.length !== 4 || version !== SESSION_VERSION || mac === undefined || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt) || expiresAt <= now)
    return false
  return matches(Buffer.from(signatureOf(secret, issuedAt, expiresAt)), Buffer.from(mac))
}

export function createLinkToken(): string {
  return Array.from({ length: LINK_TOKEN_LENGTH }, () => LINK_TOKEN_ALPHABET[randomInt(LINK_TOKEN_ALPHABET.length)]).join('')
}

export function createSessionSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url')
}

export function tokenMatches(provided: string | undefined, expected: string | null): boolean {
  if (provided === undefined || expected === null || expected === '')
    return false
  const candidate = /^[2-9A-HJ-NP-Z]{8}$/u.test(expected) && /^[2-9A-HJ-NP-Za-hj-np-z]{8}$/u.test(provided) ? provided.toUpperCase() : provided
  return matches(Buffer.from(candidate), Buffer.from(expected))
}

export function rateLimitAfterFailure(
  record: RemoteAuthFailureRecord | undefined,
  now: number,
  limit = AUTH_FAILURE_LIMIT,
  banMs = AUTH_BAN_MS,
): RemoteAuthFailureRecord {
  const base = record === undefined || (record.bannedUntil > 0 && record.bannedUntil <= now) ? 0 : record.failures
  const failures = base + 1
  return failures >= limit ? { failures: 0, bannedUntil: now + banMs } : { failures, bannedUntil: 0 }
}

export function rateLimitBlockedMs(record: RemoteAuthFailureRecord | undefined, now: number): number {
  return record === undefined ? 0 : Math.max(0, record.bannedUntil - now)
}

function signatureOf(secret: string, issuedAt: number, expiresAt: number): string {
  return createHmac('sha256', secret).update(`${SESSION_VERSION}.${issuedAt}.${expiresAt}`).digest('hex')
}

function matches(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}
