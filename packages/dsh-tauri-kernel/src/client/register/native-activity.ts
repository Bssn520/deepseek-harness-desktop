import type { ClientContext, SlotRegistry } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'
import { NativeActivity } from '../components/native-activity'

const ACTIVITY_SLOT = 'conversation.input.dock'

export const nativeActivity = defineRegister<ClientContext>((controller, _ctx, adapter) => {
  const slots = adapter.service<SlotRegistry>('slots')
  if (typeof slots?.inject !== 'function' || typeof slots.register !== 'function' || typeof slots.spec !== 'function') {
    console.warn(`[${PLUGIN_ID}] native activity unavailable; official dock registration APIs are missing`)
    return
  }
  controller.add(slots.inject(ACTIVITY_SLOT, () => {
    const spec = slots.spec(ACTIVITY_SLOT)
    if (spec?.kind !== 'list' || spec.scope !== 'session') {
      console.warn(`[${PLUGIN_ID}] native activity unavailable; official dock contract differs`)
      return () => {}
    }
    return slots.register({ name: ACTIVITY_SLOT, id: `${PLUGIN_ID}:activity`, registrant: PLUGIN_ID, order: 1 }, NativeActivity)
  }))
})
