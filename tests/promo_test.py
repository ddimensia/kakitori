"""Usage: serve the app on BASE (default http://127.0.0.1:8765/), then: python3 tests/promo_test.py
Links to Kumitate Kanji: the Today banner (shown until closed, and staying closed), the footer,
the welcome page and the built-in kanji list setting."""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')
URL = 'https://ddimensia.github.io/kumitate-kanji/'


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('ok -', msg)


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1100, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    # Opening a page other than the welcome page counts as having seen it.
    page.goto(BASE + '#settings')
    page.wait_for_selector('.settings-form')
    page.goto(BASE + '#today')
    page.wait_for_selector('.today')

    check(page.locator('.promo').count() == 1, 'Today shows the Kumitate Kanji banner')
    check(page.get_attribute('.promo-link', 'href') == URL, 'banner links to Kumitate Kanji')
    check(page.get_attribute('.promo-link', 'target') == '_blank', 'banner opens in a new tab')
    check('WaniKani' not in page.inner_text('.promo'), 'banner does not mention WaniKani')

    page.click('[data-act="promo-close"]')
    check(page.locator('.promo').count() == 0, 'closing the banner hides it')
    page.wait_for_timeout(300)
    page.reload()
    page.wait_for_selector('.today')
    check(page.locator('.promo').count() == 0, 'the banner stays closed after a reload')

    check(page.locator(f'.site-foot a[href="{URL}"]').count() == 1, 'footer links to Kumitate Kanji')

    page.goto(BASE + '#welcome')
    page.wait_for_selector('.welcome')
    check(page.locator(f'.welcome a[href="{URL}"]').count() == 1, 'welcome page mentions Kumitate Kanji')

    page.goto(BASE + '#settings')
    page.wait_for_selector('select[name="kanjiSource"]')
    page.select_option('select[name="kanjiSource"]', 'jlpt')
    page.wait_for_function("document.querySelector('#toast').textContent === 'Saved.'", timeout=15000)
    page.goto(BASE + '#today')
    page.goto(BASE + '#settings')
    page.wait_for_selector('select[name="kanjiSource"]')
    check(page.locator(f'.settings-form a[href="{URL}"]').count() == 1, 'built-in kanji list setting suggests Kumitate Kanji')

    check(not errors, 'no page errors' + ('' if not errors else ': ' + '; '.join(errors)))
    b.close()
