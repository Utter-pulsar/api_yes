/// <reference types="vite/client" />

import type * as React from 'react'

// React 19 moved the global JSX namespace under React.JSX. Re-expose `JSX.Element`
// so component return-type annotations keep working across the renderer.
declare global {
  namespace JSX {
    type Element = React.JSX.Element
    type IntrinsicElements = React.JSX.IntrinsicElements
  }
}
