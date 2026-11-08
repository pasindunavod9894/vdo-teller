import { Baloo_2, Inter, Nunito, Playfair_Display, Poppins, Space_Grotesk } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const space = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' })
const baloo = Baloo_2({ subsets: ['latin'], variable: '--font-baloo' })
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito' })
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair' })
const poppins = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-poppins' })

// All font pairs are loaded here; the theme only chooses which CSS variable is active.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${inter.variable} ${space.variable} ${baloo.variable} ${nunito.variable} ${playfair.variable} ${poppins.variable}`}>{children}</div>
}
