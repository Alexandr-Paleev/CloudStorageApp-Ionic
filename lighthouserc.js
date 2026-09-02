/**
 * Lighthouse CI — the half of the performance story a byte count cannot tell.
 *
 * scripts/check-bundle-size.js guards what the browser downloads; this guards
 * what happens once it has. They fail for different reasons: a chunk moving
 * back onto the critical path shows up in both, a render-blocking font or a
 * layout shift only here.
 *
 * Served straight out of dist/ rather than from a preview deployment. Vercel
 * previews sit behind Deployment Protection and answer an unauthenticated
 * request with a redirect to an SSO login, so auditing one needs a bypass
 * secret in CI — worth doing when the serverless runtime is what is being
 * measured, which for a static shell it is not.
 */
module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      /* index.html plus the two static legal pages — the whole set this build
         emits as HTML. Every route past the login wall is the same shell. */
      numberOfRuns: 1,

      /* Desktop, deliberately. Mobile emulation throttles the CPU fourfold and
         the resulting score swings by twenty points between runs on a shared
         runner, which makes an assertion on it noise rather than a signal. The
         numbers in the README say which preset produced them. */
      settings: { preset: 'desktop' },
    },
    assert: {
      assertions: {
        /* These three are close to deterministic — they check markup, headers
           and metadata rather than timing — and all three sit at 100 today, so
           a failure means something actually broke. */
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.95 }],

        /* 97 on the shell locally, 100 on the legal pages. The floor is set low
           enough that a slow runner cannot fail the build on its own, and high
           enough that putting a blocking script back on the critical path
           will. */
        'categories:performance': ['error', { minScore: 0.8 }],
      },
    },
    upload: { target: 'filesystem', outputDir: './.lighthouseci' },
  },
};
