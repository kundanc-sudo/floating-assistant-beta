import { useEffect } from 'react'

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    const guardLinks = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0) return
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!target || target.target === '_blank' || new URL(target.href, window.location.href).origin !== window.location.origin) return
      if (!window.confirm('You have unsaved changes. Discard them?')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', guardLinks, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', guardLinks, true)
    }
  }, [dirty])

  return () => !dirty || window.confirm('You have unsaved changes. Discard them?')
}
