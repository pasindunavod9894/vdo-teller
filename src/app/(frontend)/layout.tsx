import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Turn any topic into a running video series.',
  title: 'VDO Teller',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
