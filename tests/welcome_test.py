"""Usage: serve the app on BASE (default http://127.0.0.1:8765/), then: python3 tests/welcome_test.py
Welcome page: shown on a first visit, skipped once seen or for people who already have progress,
reachable from the footer, and laid out on desktop, phone and in dark mode."""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')
OUT = os.environ.get('SHOTS', 'shots')
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    errors = []

    def new_page(**kw):
        page = b.new_page(service_workers='block', **kw)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'TUNNEL' not in m.text else None)
        return page

    # First visit, no hash
    page = new_page(viewport={'width': 1280, 'height': 860})
    page.goto(BASE); page.wait_for_selector('.welcome .w-step-sq svg')
    page.wait_for_selector('.w-demo .w-mark svg', timeout=15000)  # stroke order finished, red-pen mark drawn
    page.wait_for_timeout(900)
    print('first visit:', page.url.split('/')[-1], '| h1:', page.locator('.welcome h1').inner_text().replace('\n', ' / '),
          '| buttons:', page.locator('.welcome a.btn').all_inner_texts(), '| nav current:', page.locator('.nav a[aria-current]').count())
    print('footer links:', [a for a in page.locator('.site-foot a').all_inner_texts()], 'visible about:', page.locator('.site-foot a[href="#welcome"]').is_visible())
    page.screenshot(path=f'{OUT}/welcome-desktop.png')
    page.screenshot(path=f'{OUT}/welcome-desktop-full.png', full_page=True)
    # Replay
    page.click('.w-square')
    print('replay clears mark:', page.locator('.w-demo .w-mark svg').count() == 0)
    # Reload before leaving: still the welcome page
    page.reload(); page.wait_for_selector('.welcome')
    print('reload without leaving -> welcome:', page.locator('.welcome').count() == 1)
    page.click('.w-hero .w-cta')
    page.wait_for_selector('.today')
    page.wait_for_timeout(300)
    print('after Get started:', page.url.split('/')[-1], '| welcomed:', page.evaluate("(async () => (await import('/js/state.js')).state.settings.welcomed)()"))
    page.goto(BASE); page.reload(); page.wait_for_selector('.today')
    print('second visit opens:', page.url.split('/')[-1] or '(root)', '| today shown')
    page.click('.site-foot a[href="#welcome"]')
    page.wait_for_selector('.welcome')
    print('About link -> buttons:', page.locator('.welcome a.btn').all_inner_texts())
    page.close()

    # Existing user from before the welcome page: settings saved without the flag
    page = new_page(viewport={'width': 1280, 'height': 860})
    page.goto(BASE + '#settings'); page.wait_for_selector('.settings')
    page.evaluate("(async () => { const st = await import('/js/store.js'); const s = await import('/js/state.js'); const cur = { ...s.state.settings }; delete cur.welcomed; cur.newPerDay = 12; await st.kvSet('settings', cur); })()")
    page.goto(BASE); page.reload(); page.wait_for_selector('.today, .welcome')
    print('existing user opens:', 'welcome' if page.locator('.welcome').count() else 'today')
    page.close()

    # Phone, light and dark
    for scheme in ('light', 'dark'):
        page = new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, color_scheme=scheme)
        page.goto(BASE); page.wait_for_selector('.welcome .w-step-sq svg')
        page.wait_for_selector('.w-demo .w-mark svg', timeout=15000)
        page.wait_for_timeout(900)
        page.screenshot(path=f'{OUT}/welcome-phone-{scheme}.png', full_page=True)
        page.close()

    # Reduced motion: shows the finished character right away
    page = new_page(viewport={'width': 1280, 'height': 860}, reduced_motion='reduce')
    page.goto(BASE); page.wait_for_selector('.w-demo .w-mark svg', timeout=3000)
    print('reduced motion: finished at once')
    page.close()
    print('errors:', errors)
    b.close()
