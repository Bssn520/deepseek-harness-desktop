import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeActivityItem, NativeActivityState } from '../../shared/activity'
import type {} from './slot-contract'
import { locale } from '../locales'
import { backendFromIdentity, isForkedIdentity } from '../service/kernel-identity'

export type NativeActivityProps = PropsRuntime<'conversation.input.dock'>

export function NativeActivity(props: NativeActivityProps) {
  locale.useLocale()
  const binding = props.useProjection('bridgeKernel')
  const activity = props.useProjection('bridgeActivity')
  const backend = backendFromIdentity(binding)
  if (backend === undefined || backend === 'dsh' || isForkedIdentity(binding, props.sessionId))
    return null
  return (
    <section aria-label={locale.text('activity.title')} data-dsh-native-activity={props.sessionId} className="w-full text-secondary">
      <p>{locale.text('activity.readOnly')}</p>
      {activity === undefined ? <p role="status">{locale.text('activity.unavailable')}</p> : <ActivityContent activity={activity} />}
    </section>
  )
}

function ActivityContent({ activity }: { activity: NativeActivityState }) {
  const sections = ['subagents', 'jobs'] as const
  return (
    <>
      <details>
        <summary>{locale.text('activity.plan')}</summary>
        {activity.unavailable.plan !== null ? <Unavailable reason={activity.unavailable.plan} /> : null}
        {activity.plan?.explanation ? <p>{activity.plan.explanation}</p> : null}
        {activity.plan === null || activity.plan.steps.length === 0
          ? <p>{locale.text('activity.empty')}</p>
          : (
              <ol>
                {activity.plan.steps.map((step, index) => <li key={`${index}:${step.content}`}>{`${step.content} — ${locale.text(`activity.${step.status}`)}`}</li>)}
              </ol>
            )}
      </details>
      {sections.map(section => (
        <details key={section}>
          <summary>{`${locale.text(`activity.${section}`)} (${activity[section].length})`}</summary>
          {activity.unavailable[section] !== null ? <Unavailable reason={activity.unavailable[section]} /> : null}
          {activity[section].length === 0
            ? <p>{locale.text('activity.empty')}</p>
            : <ul>{activity[section].map(item => <ActivityItem key={item.id} item={item} />)}</ul>}
        </details>
      ))}
    </>
  )
}

function Unavailable({ reason }: { reason: string }) {
  const key = reason === 'partial' ? 'activity.partial' : reason === 'mapping-failed' ? 'activity.mappingFailed' : 'activity.unavailable'
  return <p role="status">{locale.text(key)}</p>
}

function ActivityItem({ item }: { item: NativeActivityItem }) {
  return (
    <li>
      <span>{`${item.label ?? item.id} — ${item.status ?? locale.text('activity.unknown')}`}</span>
      {item.parentId ? <p>{`${locale.text('activity.parent')}: ${item.parentId}`}</p> : null}
      {item.details ? <p className="whitespace-pre-wrap">{item.details}</p> : null}
    </li>
  )
}
