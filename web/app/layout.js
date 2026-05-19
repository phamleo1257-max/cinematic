import "./globals.css";

export const metadata = {
  title: "Cinematic Feed",
  description:
    "AI-curated frames ranked by contrast, color richness, and visual energy",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
