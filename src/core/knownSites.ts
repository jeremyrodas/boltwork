/**
 * Common services by name, so a login titled "Netflix" gets netflix.com as its website (and so its logo)
 * without typing it. Only names that clearly mean one site; ambiguous ones (Apple Music vs Apple ID) are left out.
 */
const SITES: Record<string, string> = {
  // Shopping
  amazon: 'amazon.com', ebay: 'ebay.com', etsy: 'etsy.com', walmart: 'walmart.com', target: 'target.com', costco: 'costco.com',
  'best buy': 'bestbuy.com', bestbuy: 'bestbuy.com', ikea: 'ikea.com', wayfair: 'wayfair.com', aliexpress: 'aliexpress.com', temu: 'temu.com',
  shein: 'shein.com', 'home depot': 'homedepot.com', lowes: 'lowes.com', "lowe's": 'lowes.com', newegg: 'newegg.com', chewy: 'chewy.com',
  instacart: 'instacart.com', shopify: 'shopify.com', 'facebook marketplace': 'facebook.com',
  // Streaming and media
  netflix: 'netflix.com', hulu: 'hulu.com', 'disney+': 'disneyplus.com', 'disney plus': 'disneyplus.com', disneyplus: 'disneyplus.com',
  'hbo max': 'max.com', 'prime video': 'primevideo.com', 'paramount+': 'paramountplus.com', 'paramount plus': 'paramountplus.com',
  peacock: 'peacocktv.com', crunchyroll: 'crunchyroll.com', youtube: 'youtube.com', 'youtube tv': 'tv.youtube.com', twitch: 'twitch.tv',
  spotify: 'spotify.com', pandora: 'pandora.com', tidal: 'tidal.com', deezer: 'deezer.com', soundcloud: 'soundcloud.com', audible: 'audible.com',
  plex: 'plex.tv', 'sling tv': 'sling.com', sling: 'sling.com', fubo: 'fubo.tv', fubotv: 'fubo.tv', 'apple tv+': 'tv.apple.com',
  // Games
  steam: 'steampowered.com', 'epic games': 'epicgames.com', 'epic games store': 'epicgames.com', xbox: 'xbox.com', playstation: 'playstation.com',
  'playstation network': 'playstation.com', psn: 'playstation.com', nintendo: 'nintendo.com', 'nintendo account': 'nintendo.com',
  'battle.net': 'battle.net', blizzard: 'battle.net', 'ea app': 'ea.com', ea: 'ea.com', origin: 'ea.com', ubisoft: 'ubisoft.com',
  'ubisoft connect': 'ubisoft.com', gog: 'gog.com', 'gog.com': 'gog.com', roblox: 'roblox.com', minecraft: 'minecraft.net', 'riot games': 'riotgames.com',
  // Social and messaging
  facebook: 'facebook.com', instagram: 'instagram.com', twitter: 'x.com', x: 'x.com', threads: 'threads.net', tiktok: 'tiktok.com',
  snapchat: 'snapchat.com', reddit: 'reddit.com', linkedin: 'linkedin.com', pinterest: 'pinterest.com', tumblr: 'tumblr.com', discord: 'discord.com',
  whatsapp: 'whatsapp.com', telegram: 'telegram.org', signal: 'signal.org', bluesky: 'bsky.app', mastodon: 'joinmastodon.org', quora: 'quora.com',
  nextdoor: 'nextdoor.com', 'stack overflow': 'stackoverflow.com', stackoverflow: 'stackoverflow.com',
  // Email, cloud and accounts
  google: 'google.com', 'google account': 'google.com', gmail: 'gmail.com', outlook: 'outlook.com', hotmail: 'outlook.com', microsoft: 'microsoft.com',
  'microsoft account': 'microsoft.com', 'microsoft 365': 'microsoft365.com', 'office 365': 'microsoft365.com', yahoo: 'yahoo.com',
  'yahoo mail': 'yahoo.com', 'proton mail': 'proton.me', protonmail: 'proton.me', proton: 'proton.me', icloud: 'icloud.com', 'apple id': 'apple.com',
  'apple account': 'apple.com', aol: 'aol.com', fastmail: 'fastmail.com', zoho: 'zoho.com', dropbox: 'dropbox.com', box: 'box.com',
  'google drive': 'drive.google.com', onedrive: 'onedrive.live.com', mega: 'mega.io', backblaze: 'backblaze.com', 'adobe': 'adobe.com',
  'adobe account': 'adobe.com', canva: 'canva.com', notion: 'notion.so', evernote: 'evernote.com', todoist: 'todoist.com', trello: 'trello.com',
  // Work and developer
  github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org', slack: 'slack.com', zoom: 'zoom.us', 'microsoft teams': 'teams.microsoft.com',
  teams: 'teams.microsoft.com', atlassian: 'atlassian.com', jira: 'atlassian.com', confluence: 'atlassian.com', asana: 'asana.com',
  figma: 'figma.com', docker: 'docker.com', 'docker hub': 'hub.docker.com', npm: 'npmjs.com', aws: 'aws.amazon.com', 'amazon web services': 'aws.amazon.com',
  azure: 'azure.microsoft.com', 'google cloud': 'cloud.google.com', cloudflare: 'cloudflare.com', digitalocean: 'digitalocean.com',
  heroku: 'heroku.com', vercel: 'vercel.com', netlify: 'netlify.com', openai: 'openai.com', chatgpt: 'chatgpt.com', claude: 'claude.ai',
  anthropic: 'anthropic.com', salesforce: 'salesforce.com', hubspot: 'hubspot.com', mailchimp: 'mailchimp.com', godaddy: 'godaddy.com',
  namecheap: 'namecheap.com', squarespace: 'squarespace.com', wix: 'wix.com', wordpress: 'wordpress.com', 'tailscale': 'tailscale.com',
  // Money
  paypal: 'paypal.com', venmo: 'venmo.com', 'cash app': 'cash.app', cashapp: 'cash.app', zelle: 'zellepay.com', stripe: 'stripe.com',
  'chase': 'chase.com', 'bank of america': 'bankofamerica.com', 'wells fargo': 'wellsfargo.com', citi: 'citi.com', citibank: 'citi.com',
  'capital one': 'capitalone.com', 'american express': 'americanexpress.com', amex: 'americanexpress.com', discover: 'discover.com',
  'us bank': 'usbank.com', 'u.s. bank': 'usbank.com', pnc: 'pnc.com', 'truist': 'truist.com', usaa: 'usaa.com', 'navy federal': 'navyfederal.org',
  ally: 'ally.com', 'ally bank': 'ally.com', schwab: 'schwab.com', 'charles schwab': 'schwab.com', fidelity: 'fidelity.com', vanguard: 'vanguard.com',
  robinhood: 'robinhood.com', 'e*trade': 'etrade.com', etrade: 'etrade.com', coinbase: 'coinbase.com', kraken: 'kraken.com', sofi: 'sofi.com',
  chime: 'chime.com', wise: 'wise.com', revolut: 'revolut.com', 'credit karma': 'creditkarma.com', experian: 'experian.com', equifax: 'equifax.com',
  transunion: 'transunion.com', intuit: 'intuit.com', turbotax: 'turbotax.intuit.com', quickbooks: 'quickbooks.intuit.com', mint: 'mint.intuit.com',
  // Travel and transport
  airbnb: 'airbnb.com', 'booking.com': 'booking.com', booking: 'booking.com', expedia: 'expedia.com', 'hotels.com': 'hotels.com', vrbo: 'vrbo.com',
  kayak: 'kayak.com', tripadvisor: 'tripadvisor.com', uber: 'uber.com', 'uber eats': 'ubereats.com', lyft: 'lyft.com', doordash: 'doordash.com',
  grubhub: 'grubhub.com', 'delta': 'delta.com', 'delta air lines': 'delta.com', 'american airlines': 'aa.com', 'united': 'united.com',
  'united airlines': 'united.com', southwest: 'southwest.com', 'southwest airlines': 'southwest.com', jetblue: 'jetblue.com', alaska: 'alaskaair.com',
  'alaska airlines': 'alaskaair.com', marriott: 'marriott.com', 'marriott bonvoy': 'marriott.com', hilton: 'hilton.com', 'hilton honors': 'hilton.com',
  hyatt: 'hyatt.com', ihg: 'ihg.com',
  // Phone, internet and utilities
  verizon: 'verizon.com', 'at&t': 'att.com', att: 'att.com', 't-mobile': 't-mobile.com', tmobile: 't-mobile.com', xfinity: 'xfinity.com',
  comcast: 'xfinity.com', spectrum: 'spectrum.net', 'google fi': 'fi.google.com', mint_mobile: 'mintmobile.com', 'mint mobile': 'mintmobile.com',
  visible: 'visible.com', 'cox': 'cox.com', 'optimum': 'optimum.net',
  // Other
  'state farm': 'statefarm.com', geico: 'geico.com', progressive: 'progressive.com', allstate: 'allstate.com', 'kaiser permanente': 'kp.org',
  duolingo: 'duolingo.com', coursera: 'coursera.org', udemy: 'udemy.com', khan_academy: 'khanacademy.org', 'khan academy': 'khanacademy.org',
  goodreads: 'goodreads.com', kindle: 'amazon.com', patreon: 'patreon.com', 'ring': 'ring.com', nest: 'home.nest.com', 'google nest': 'home.nest.com',
  ancestry: 'ancestry.com', '23andme': '23andme.com', strava: 'strava.com', fitbit: 'fitbit.com', peloton: 'onepeloton.com', myfitnesspal: 'myfitnesspal.com',
  ticketmaster: 'ticketmaster.com', stubhub: 'stubhub.com', eventbrite: 'eventbrite.com', yelp: 'yelp.com', zillow: 'zillow.com', redfin: 'redfin.com',
  craigslist: 'craigslist.org', indeed: 'indeed.com', glassdoor: 'glassdoor.com', '1password': '1password.com', bitwarden: 'bitwarden.com',
  lastpass: 'lastpass.com', dashlane: 'dashlane.com', nordvpn: 'nordvpn.com', expressvpn: 'expressvpn.com', mullvad: 'mullvad.net',
  'proton vpn': 'protonvpn.com', protonvpn: 'protonvpn.com', wikipedia: 'wikipedia.org', 'the new york times': 'nytimes.com', 'new york times': 'nytimes.com',
  nytimes: 'nytimes.com', 'washington post': 'washingtonpost.com', medium: 'medium.com', substack: 'substack.com', usps: 'usps.com', ups: 'ups.com',
  fedex: 'fedex.com', irs: 'irs.gov', 'social security': 'ssa.gov', ssa: 'ssa.gov',
};

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const INDEX = new Map(Object.entries(SITES).map(([k, v]) => [norm(k.replace(/_/g, ' ')), v]));

/**
 * The website for a title like "Netflix" or "Chase (checking)": the known name, ignoring case, anything in brackets
 * and a trailing "account" or "login". Null when the title isn't a known service.
 */
export function websiteForName(title: string): string | null {
  let t = norm(title).replace(/\s*[([].*$/, '').replace(/\s*[-–—:|]\s.*$/, '').trim();
  const direct = INDEX.get(t);
  if (direct) return direct;
  t = t.replace(/\s+(account|login|sign[- ]?in|personal|work|business)$/, '').trim();
  return INDEX.get(t) ?? null;
}
