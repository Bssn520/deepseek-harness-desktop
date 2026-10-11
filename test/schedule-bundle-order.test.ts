import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

const rust = readFileSync(new URL('../src-tauri/src/service/patch/schedule_order.rs', import.meta.url), 'utf8')
const match = /const ORDERED_LOOP: &str = r#"([\s\S]*?)"#;/.exec(rust)
if (!match)
  throw new Error('schedule_order.rs: missing ORDERED_LOOP')
const script = match[1].replace(/\tfor \(const packageName of dshTauriOrderedBundles\) try \{$/, 'dshTauriOrderedBundles')

it.each([
  {
    bundles: ['dsh-web-app', 'dsh-tauri-scheduler', 'user-plugin', '@deepseek-ai/dsh-experimental-schedule-bundle'],
    expected: ['dsh-web-app', '@deepseek-ai/dsh-experimental-schedule-bundle', 'dsh-tauri-scheduler', 'user-plugin'],
  },
  {
    bundles: ['dsh-web-app', '@deepseek-ai/dsh-experimental-schedule-bundle', 'user-plugin', 'dsh-tauri-scheduler'],
    expected: ['dsh-web-app', '@deepseek-ai/dsh-experimental-schedule-bundle', 'user-plugin', 'dsh-tauri-scheduler'],
  },
  {
    bundles: ['dsh-web-app', '@deepseek-ai/dsh-experimental-schedule-bundle', 'user-plugin'],
    expected: ['dsh-web-app', '@deepseek-ai/dsh-experimental-schedule-bundle', 'user-plugin'],
  },
  {
    bundles: ['dsh-web-app', 'dsh-tauri-scheduler', 'user-plugin'],
    expected: ['dsh-web-app', 'dsh-tauri-scheduler', 'user-plugin'],
  },
  {
    bundles: ['dsh-web-app', 'user-plugin'],
    expected: ['dsh-web-app', 'user-plugin'],
  },
  { bundles: [], expected: [] },
])('profile bundles $bundles load official schedule before its desktop override', ({ bundles, expected }) => {
  const input = Object.freeze([...bundles])
  expect(runInNewContext(script, { bundles: input })).toEqual(expected)
  expect(input).toEqual(bundles)
  expect(runInNewContext(script, { bundles: Object.freeze(expected) })).toEqual(expected)
})
