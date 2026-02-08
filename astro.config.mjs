import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://huisleegmakers.gent',
  output: 'static',
  adapter: vercel(),
  integrations: [
    tailwind({ configFile: './tailwind.config.cjs' }),
    sitemap({
      changefreq: 'weekly',
      lastmod: new Date(),
      serialize(item) {
        // Homepage: hoogste prioriteit
        if (item.url === 'https://huisleegmakers.gent/') {
          item.priority = 1.0;
          item.changefreq = 'weekly';
        }
        // Locatiepagina's: hoge prioriteit
        else if (item.url.includes('/woningontruiming-')) {
          item.priority = 0.8;
          item.changefreq = 'monthly';
        }
        // Privacy pagina: lage prioriteit
        else if (item.url.includes('/privacy')) {
          item.priority = 0.3;
          item.changefreq = 'yearly';
        }
        // Overige pagina's
        else {
          item.priority = 0.5;
          item.changefreq = 'monthly';
        }
        return item;
      },
    }),
  ],
});
