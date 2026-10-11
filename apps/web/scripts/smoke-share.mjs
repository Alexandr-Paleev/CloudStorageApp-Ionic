/**
 * What the smoke test asks about the page a share link opens.
 *
 * It is the one page of the site that is rendered when it is asked for, and
 * the one that talks to another origin, so most of what can go wrong with it
 * cannot go wrong with the others: what it shows depends on what the app's
 * functions say, its button asks them from the browser, and its policy has
 * to let that one request through and no other.
 *
 * The functions here are a stand-in, `stub-api.mjs`, and `smoke.mjs` says
 * why and builds the site to match.
 */
import { gzipSync } from 'node:zlib';
import { RAN, TOKENS } from './stub-api.mjs';

/**
 * What a recipient's browser downloads to show the page and work its button,
 * gzipped, in kB of 1000 bytes: the scripts and the stylesheets, which is
 * how `scripts/check-bundle-size.js` counts the app's first load. The two
 * numbers are meant to be read side by side.
 *
 * 142.0 kB today. The app's first load, built on the same machine the same
 * day, was 437.6. The page's own script is 1.0 of the 142.0: the button,
 * and the check on the address it is handed. The rest is React and Next,
 * which every page of this site carries whether or not anything on it
 * moves.
 *
 * Set just above what was measured, as the app's are, so that the pull
 * request that adds to it is the one that turns red.
 */
const BUDGET_KB = 148;

const kB = (bytes) => (bytes / 1000).toFixed(1);

/** The origins a policy names besides the site's own. */
const namedIn = (policy) => policy.match(/https?:\/\/[^\s;]+/g) ?? [];

/**
 * The two headers that are this page's and no other's. They are set by the
 * address, so they are on every answer there, a 404 as much as a page.
 */
function expectTheHeadersOfASharePage(response, appOrigin, expect) {
  const policy = response.headers.get('content-security-policy') ?? '';
  const named = namedIn(policy);

  expect(
    named.length === 1 && named[0] === appOrigin,
    `the share page's policy should name the app (${appOrigin}) and nothing else, and names: ` +
      (named.join(', ') || 'nothing')
  );
  expect(
    policy.includes(`connect-src 'self' ${appOrigin}`),
    'the share page may not ask the app for the file: connect-src does not name it'
  );

  /* The address of the page is all it takes to read the file. The page
     carries a tag that says the same, and the tag cannot be told from the
     one the layout puts on every page of a build that is not production. */
  expect(
    response.headers.get('x-robots-tag') === 'noindex, nofollow',
    'the share page does not ask to be left out of every index'
  );
}

/** What a client that runs no script is given: a messenger, unfurling the link. */
export async function sharePageAsACrawler({ origin, stub, appOrigin, expect }) {
  const at = (token) => `${origin}/s/${token}`;

  /* The first request for this link, and not from a crawler Next knows by
     name: the tags below have to be in the head for anybody. */
  const page = await fetch(at(TOKENS.live));
  const html = await page.text();
  const head = html.slice(0, html.indexOf('</head>'));

  expect(page.status === 200, `a link that opens answered ${page.status}`);
  expect(/<h1[^>]*>report\.pdf<\/h1>/.test(html), 'the name of the file is not in the HTML');
  expect(html.includes('1.2 MB'), 'the size of the file is not in the HTML');
  expect(
    /<title>report\.pdf · /.test(head) &&
      /<meta property="og:title" content="report\.pdf"/.test(head),
    'a messenger is not told the name of the file'
  );
  expect(
    /<meta property="og:description" content="1\.2 MB · application\/pdf\./.test(head),
    'a messenger is not told what kind of file it is'
  );
  expect(/<meta property="og:image" content="[^"]+"/.test(head), 'the card has lost its image');

  expectTheHeadersOfASharePage(page, appOrigin, expect);
  expect(!/<link rel="canonical"/.test(html), 'the share page names itself as a canonical address');
  /* A page about a link that can be taken back is kept by nobody. */
  expect(
    /no-store/.test(page.headers.get('cache-control') ?? ''),
    `the share page may be kept by a cache: ${page.headers.get('cache-control')}`
  );

  /* Rendering the page signs nothing. The address of the file is asked for
     when a person presses the button, and by their browser. */
  expect(!html.includes('/files/'), 'an address for the file is in the HTML');
  await fetch(at(TOKENS.live));
  const live = stub.asked(TOKENS.live);
  expect(live.opened === 0, `rendering the page opened the link ${live.opened} times`);
  expect(
    live.described === 1,
    `the page was rendered twice within the minute and the functions were asked ${live.described} times`
  );

  for (const [token, sentence] of [
    [TOKENS.revoked, 'This link has been revoked'],
    [TOKENS.expired, 'This link has expired'],
  ]) {
    const ended = await fetch(at(token));
    const said = await ended.text();
    expect(ended.status === 200, `${sentence}: answered ${ended.status}`);
    expect(said.includes(`>${sentence}</h1>`), `the page does not say: ${sentence}`);
    expect(!said.includes('report.pdf'), `${sentence}, and the page still names a file`);
    expect(!said.includes('<button'), `${sentence}, and the page still offers a download`);
  }

  /* The functions would not describe this one: they refuse an address that
     asks too often, and to them this whole site is one address. The page
     is still a page, and still offers the file. */
  const unnamed = await fetch(at(TOKENS.unnamed));
  const offered = await unnamed.text();
  expect(unnamed.status === 200, `a link that could not be described answered ${unnamed.status}`);
  expect(
    offered.includes('>A file was shared with you</h1>') && offered.includes('<button'),
    'a link that could not be described offers no download'
  );
  await fetch(at(TOKENS.unnamed));
  expect(
    stub.asked(TOKENS.unnamed).described === 2,
    'a refusal was kept as if it were an answer: the next visitor did not ask again'
  );

  const missing = await fetch(at(TOKENS.missing));
  expect(missing.status === 404, `a link nobody made answered ${missing.status}`);
  expectTheHeadersOfASharePage(missing, appOrigin, expect);
  expect(
    /<title>No file behind this link · /.test(await missing.text()),
    'the page for a link nobody made has no title of its own'
  );

  /* Answered by the site itself. What could not be a token costs the
     functions nothing, and the site none of its allowance with them. */
  const before = stub.total();
  for (const garbled of ['not%20a%20token', 'favicon.ico', 'a'.repeat(200)]) {
    const response = await fetch(`${origin}/s/${garbled}`);
    expect(response.status === 404, `/s/${garbled.slice(0, 20)} answered ${response.status}`);
  }
  expect(stub.total() === before, 'the functions were asked about what could not be a token');
}

/**
 * The same page with no stand-in behind it: a site that is already running,
 * and the app it was built for.
 *
 * Nothing here can open a link, because nothing here can make one. What can
 * be asked is that the page is routed, sends its policy, and, in production,
 * reaches the real functions: a link nobody made is a 404 only if they said
 * so. Unanswered, the same address is a page with a download button.
 */
export async function sharePageOfARunningSite({ origin, production, appOrigin, expect }) {
  const garbled = await fetch(`${origin}/s/not%20a%20token`);
  expect(garbled.status === 404, `/s/not%20a%20token answered ${garbled.status}`);
  expectTheHeadersOfASharePage(garbled, appOrigin, expect);

  if (!production) return;

  const missing = await fetch(`${origin}/s/${TOKENS.missing}`);
  const html = await missing.text();
  expect(
    missing.status === 404,
    missing.status === 200
      ? 'the site asked the functions about a link and was not answered'
      : `a link nobody made answered ${missing.status}`
  );
  /* A site with no share page at all answers this address 404 as well. The
     title tells the two apart. */
  expect(
    /<title>No file behind this link · /.test(html),
    'the 404 for a link nobody made is not the share page saying so'
  );
  /* This page is rendered by a function, so it reads the site's address
     when it is asked, and not when the site is built as the others do. */
  expect(
    html.includes(`<meta property="og:image" content="${origin}/`),
    "the card of a share page does not point at this site's own image"
  );
}

/** What downloading the page costs, by what kind of thing was downloaded. */
async function weigh(browser, url) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const responses = [];
    page.on('response', (response) => responses.push(response));
    await page.goto(url, { waitUntil: 'networkidle' });

    const weight = { document: 0, script: 0, stylesheet: 0, ahead: 0 };
    for (const response of responses) {
      const body = await response.body().catch(() => null);
      if (!body) continue;
      const kind = response.request().resourceType();
      weight[kind in weight ? kind : 'ahead'] += gzipSync(body).length;
    }
    return weight;
  } finally {
    await context.close();
  }
}

/** What a browser makes of it: the button, the policy, and what it weighs. */
export async function sharePageAsAVisitor({ browser, origin, stub, expect, audit }) {
  const at = (token) => `${origin}/s/${token}`;
  const context = await browser.newContext();
  const page = await context.newPage();

  /* Some of what follows is refused on purpose, and a browser prints every
     refusal. So refusals are counted apart, by address, and everything else
     the browser complains about is a complaint: a request the policy
     stopped is one of those. */
  const complaints = [];
  const refused = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      complaints.push(message.text());
    }
  });
  page.on('pageerror', (error) => complaints.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) refused.push(`${response.status()} ${response.url()}`);
  });

  const heading = () => page.getByRole('heading', { level: 1 }).innerText();
  const download = page.getByRole('button', { name: 'Download' });
  /* Next keeps an alert of its own outside `main`, to announce a new page. */
  const problem = page.locator('main [role="alert"]');
  const open = (token) => page.goto(at(token), { waitUntil: 'networkidle' });
  const arriveAtTheFile = () =>
    page.waitForURL(`${stub.origin}/files/**`, { timeout: 10_000 }).catch(() => {});
  const beTold = (words) =>
    problem
      .filter({ hasText: words })
      .waitFor({ timeout: 10_000 })
      .catch(() => {});

  try {
    await open(TOKENS.live);
    expect((await heading()) === 'report.pdf', 'the share page does not show the name of the file');
    await download.click();
    await arriveAtTheFile();
    expect(
      page.url().startsWith(`${stub.origin}/files/`),
      `the button did not lead to the file: the browser is at ${page.url()}`
    );
    expect(stub.asked(TOKENS.live).opened === 1, 'the link was not opened exactly once');

    /* The owner takes a link back while its page is open in somebody's
       browser. The download is refused at once. The page goes on naming the
       file until the minute is up, and that is the price of asking the
       functions once a minute and not once a visitor. */
    await open(TOKENS.takenBack);
    stub.revoke(TOKENS.takenBack);
    await download.click();
    await beTold('revoked');
    expect(
      (await problem.innerText()) === 'This link has been revoked',
      'a link revoked while its page was open was not refused in so many words'
    );
    expect(page.url() === at(TOKENS.takenBack), 'a revoked link took the browser somewhere');
    expect((await download.count()) === 0, 'a revoked link still offers a download');
    await page.reload({ waitUntil: 'networkidle' });
    expect(
      (await heading()) === 'report.pdf' && stub.asked(TOKENS.takenBack).described === 1,
      'the description of a link was not kept for the minute'
    );

    /* No name, and the file all the same: the browser asks for itself. */
    await open(TOKENS.unnamed);
    expect(
      (await heading()) === 'A file was shared with you',
      'a link that could not be described is not shown as a file all the same'
    );
    await download.click();
    await arriveAtTheFile();
    expect(
      page.url().startsWith(`${stub.origin}/files/`),
      'a link that could not be described could not be downloaded either'
    );

    /* An address that is a script. Going to it would run it on this page,
       and it would say so on the window. */
    await open(TOKENS.unsafe);
    await download.click();
    await beTold('cannot be downloaded');
    expect(
      (await page.evaluate(() => window.name)) !== RAN,
      'the browser was sent to an address that is a script, and ran it'
    );
    expect(
      (await problem.innerText().catch(() => '')).includes('cannot be downloaded'),
      'an address that is not a web address was not refused in so many words'
    );

    await open(TOKENS.broken);
    await download.click();
    await beTold('Internal server error');
    expect(
      (await problem.innerText()) === 'Internal server error' && (await download.isVisible()),
      'a failure that may pass does not leave the button to try again with'
    );

    /* Every state, at every width. A file's name is one long word as often
       as not, and the page for a link nobody made is put together by the
       browser: Next sends no markup with a 404 raised while rendering. */
    for (const token of [
      TOKENS.live,
      TOKENS.long,
      TOKENS.revoked,
      TOKENS.unnamed,
      TOKENS.missing,
    ]) {
      await audit(page, `/s/${token}`);
    }
    expect(
      (await heading()) === 'There is no file behind this link.',
      'the page for a link nobody made does not say so'
    );

    const unexpected = refused.filter(
      (answer) => !answer.includes(stub.origin) && !answer.endsWith(at(TOKENS.missing))
    );
    expect(
      unexpected.length === 0,
      `the share page asked for something it was refused: ${unexpected.join(' | ')}`
    );
    expect(
      complaints.length === 0,
      `the browser complained on the share page: ${complaints.join(' | ')}`
    );
  } finally {
    await context.close();
  }

  /* Without scripts the page is still the page, and says why its button
     does nothing. Asked of the text as it is laid out, because a locator
     does not look inside a `noscript`, and because that text is only laid
     out when scripts are off. */
  const plain = await browser.newContext({ javaScriptEnabled: false });
  try {
    const still = await plain.newPage();
    await still.goto(at(TOKENS.live));
    const shown = await still.locator('main').innerText();
    expect(
      shown.includes('report.pdf') && shown.includes('The download needs JavaScript'),
      'with scripts off, the share page does not say why the download does nothing'
    );
  } finally {
    await plain.close();
  }

  const weight = await weigh(browser, at(TOKENS.live));
  const firstLoad = weight.script + weight.stylesheet;
  console.log(
    `The page a share link opens: ${kB(firstLoad)} kB of scripts and styles, gzipped, ` +
      `of a budget of ${BUDGET_KB}. Its HTML is ${kB(weight.document)} kB, and ` +
      `${kB(weight.ahead)} kB more is fetched ahead for the links around it.`
  );
  expect(
    firstLoad <= BUDGET_KB * 1000,
    `the share page is ${kB(firstLoad - BUDGET_KB * 1000)} kB over its budget of ${BUDGET_KB} kB. ` +
      'Either make it smaller, or raise the budget in scripts/smoke-share.mjs and say why in the commit.'
  );
}
