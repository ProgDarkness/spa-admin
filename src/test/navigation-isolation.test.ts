import { expect, test } from 'vitest'
import { routerMock, setPathname, usePathname } from './navigation'

test('primer test ensucia el estado de navegación', () => {
  routerMock.push('/sucio')
  setPathname('/sucio')

  expect(routerMock.push).toHaveBeenCalledTimes(1)
})

test('segundo test arranca con el estado de navegación limpio', () => {
  expect(routerMock.push).not.toHaveBeenCalled()
  expect(usePathname()).toBe('/')
})
