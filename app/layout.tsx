import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { buildBootstrapScript } from "@/lib/ui-persistence/bootstrap-script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lazarillo Gestión",
  description: "Sistema de gestión operativa",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Lazarillo",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

const filtersBootstrapScript = buildBootstrapScript([
  {
    storageKey: "dashboard:state",
    statePath: "state.showFilters",
    target: "documentElement",
    attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
  },
]);

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning /* dark-mode script modifies classList before hydration */
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')})()`,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: filtersBootstrapScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
