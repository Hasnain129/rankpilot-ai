import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Firestore Rules Verification Suite — RankPilot AI "Dirty Dozen"
 * Run with Firebase Emulator: `firebase emulators:exec --only firestore "npx tsx firestore.rules.test.ts"`
 */
async function runTests() {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'rankpilot-ai-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'websites/web_a'), {
        ownerId: 'user_a',
        name: 'Acme SaaS',
        url: 'https://acme.io',
        domain: 'acme.io',
        trackingId: 'rp_acme_001',
        seoScore: 86,
        pagesScanned: 12,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'trackingKeys/rp_acme_001'), {
        trackingId: 'rp_acme_001',
        websiteId: 'web_a',
        ownerId: 'user_a',
        domain: 'acme.io',
        createdAt: new Date(),
      });
      await setDoc(doc(db, 'leads/lead_a'), {
        ownerId: 'user_a',
        websiteId: 'web_a',
        name: 'Alice Client',
        email: 'alice@client.com',
        leadSource: 'Organic Search',
        status: 'New',
        estimatedValue: 2500,
        trackingSource: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'quotes/quote_accepted'), {
        ownerId: 'user_a',
        websiteId: 'web_a',
        customerName: 'Alice Client',
        customerEmail: 'alice@client.com',
        serviceOrProduct: 'SEO Retainer',
        amount: 3000,
        currency: 'USD',
        status: 'Accepted',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const userA = testEnv.authenticatedContext('user_a', { email_verified: true }).firestore();
    const userB = testEnv.authenticatedContext('user_b', { email_verified: true }).firestore();
    const userUnverified = testEnv.authenticatedContext('user_unverified', { email_verified: false }).firestore();
    const anon = testEnv.unauthenticatedContext().firestore();

    // 1. Identity Spoofing on Website Create
    await assertFails(setDoc(doc(userA, 'websites/web_spoof'), {
      ownerId: 'user_b', name: 'Evil', url: 'https://evil.com', domain: 'evil.com',
      trackingId: 'rp_123456', seoScore: 80, pagesScanned: 1, status: 'active',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));

    // 2. Ghost Field Injection
    await assertFails(setDoc(doc(userA, 'websites/web_ghost'), {
      ownerId: 'user_a', name: 'Acme', url: 'https://acme.com', domain: 'acme.com',
      trackingId: 'rp_123457', seoScore: 90, pagesScanned: 1, status: 'active',
      isAdmin: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));

    // 3. Privilege Escalation on User Profile
    await assertFails(setDoc(doc(userA, 'users/user_a'), {
      uid: 'user_a', email: 'a@test.com', displayName: 'User A',
      role: 'admin', plan: 'free', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));

    // 4. Cross-Tenant Read of Leads
    await assertFails(getDoc(doc(userB, 'leads/lead_a')));

    // 5. Blanket List Scraping
    await assertFails(getDocs(collection(userB, 'leads')));

    // 6. Orphaned Lead Creation
    await assertFails(setDoc(doc(userA, 'leads/lead_orphan'), {
      ownerId: 'user_a', websiteId: 'nonexistent_web', name: 'Jane', email: 'jane@co.com',
      leadSource: 'Direct', status: 'New', estimatedValue: 500, trackingSource: 'manual',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));

    // 7. Timestamp Forgery
    await assertFails(setDoc(doc(userA, 'leads/lead_time'), {
      ownerId: 'user_a', websiteId: 'web_a', name: 'Jane', email: 'jane@co.com',
      leadSource: 'Direct', status: 'New', estimatedValue: 500, trackingSource: 'manual',
      createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2020-01-01T00:00:00Z'),
    }));

    // 8. ID Poisoning
    await assertFails(setDoc(doc(userA, `websites/${'a'.repeat(200)}`), {
      ownerId: 'user_a', name: 'Long', url: 'https://long.com', domain: 'long.com',
      trackingId: 'rp_long12', seoScore: 50, pagesScanned: 1, status: 'active',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));

    // 9. Terminal State Mutation on Accepted Quote
    await assertFails(updateDoc(doc(userA, 'quotes/quote_accepted'), {
      status: 'Pending', amount: 999999, updatedAt: serverTimestamp(),
    }));

    // 10. Unverified Email Write Bypass
    await assertFails(setDoc(doc(userUnverified, 'websites/web_unverified'), {
      ownerId: 'user_unverified', name: 'Test', url: 'https://test.com', domain: 'test.com',
      trackingId: 'rp_unver1', seoScore: 50, pagesScanned: 1, status: 'active',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));

    // 11. Value Poisoning on Lead Update
    await assertFails(updateDoc(doc(userA, 'leads/lead_a'), {
      status: 12345, updatedAt: serverTimestamp(),
    }));

    // 12. Spoofed Tracking Event
    await assertFails(setDoc(doc(anon, 'visitorEvents/evt_spoof'), {
      ownerId: 'user_a', websiteId: 'web_a', trackingId: 'rp_invalid_key',
      visitorId: 'v1', sessionId: 's1', eventType: 'pageview', path: '/',
      trafficSource: 'Direct', deviceType: 'desktop', conversionValue: 0,
      createdAt: serverTimestamp(),
    }));

    // Valid Owner Operations Should Succeed
    await assertSucceeds(getDocs(query(collection(userA, 'leads'), where('ownerId', '==', 'user_a'))));
    await assertSucceeds(setDoc(doc(anon, 'visitorEvents/evt_valid'), {
      ownerId: 'user_a', websiteId: 'web_a', trackingId: 'rp_acme_001',
      visitorId: 'v_real', sessionId: 's_real', eventType: 'pageview', path: '/pricing',
      trafficSource: 'Organic Search', deviceType: 'desktop', conversionValue: 0,
      createdAt: serverTimestamp(),
    }));

    console.log('All Dirty Dozen & positive security tests passed.');
  } finally {
    await testEnv.cleanup();
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
