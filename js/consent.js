// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh
/*
 * Consent: purposes, versioned notices, and an append-only ledger sealed with a hash chain.
 * Clinical consent to treatment is kept apart from consent to uses of personal data.
 * Pure functions with no DOM or storage access, so they can be unit-tested in Node.
 */
(function (root) {
  'use strict';

  /* ---------- SHA-256 (synchronous, so a seal can be checked anywhere) ---------- */

  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

  function utf8(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) { c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00); }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }

  function sha256(str) {
    const bytes = utf8(str), len = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const bits = len * 8;
    for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? Math.floor(bits / Math.pow(2, i * 8)) & 255 : (bits >>> (i * 8)) & 255);
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    const rot = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (k + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
    }
    return h.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  /* ---------- purposes ---------- */

  // `flag` is the field in patient.consent that the rest of the app checks.
  const PURPOSES = [
    { id: 'treatment', kind: 'clinical', flag: 'therapy', icon: 'treatment' },
    { id: 'records', kind: 'data', flag: 'records', icon: 'records' },
    { id: 'students', kind: 'data', flag: 'students', icon: 'students' },
    { id: 'reports', kind: 'data', flag: 'shareReports', icon: 'reports' },
    { id: 'reminders', kind: 'data', flag: 'reminders', icon: 'reminders' },
    { id: 'teaching', kind: 'data', flag: 'teaching', icon: 'teaching' }
  ];

  const RELATIONSHIPS = {
    self: 'The patient',
    parent: 'Parent',
    guardian: 'Guardian of a child (not a parent)',
    'legal-guardian': 'Legal guardian of an adult',
    'nominated-rep': 'Nominated representative'
  };
  const ON_BEHALF = ['parent', 'guardian', 'legal-guardian', 'nominated-rep'];

  // For adults who cannot decide for themselves: what gives this person the authority. Confirm the list with the lawyer.
  const GUARDIAN_BASIS = [
    'Court order appointing a guardian',
    'Limited guardianship under the Rights of Persons with Disabilities Act 2016',
    'Legal guardian under the National Trust Act 1999',
    'Nominated representative under the Mental Healthcare Act 2017',
    'Other (describe in the reference)'
  ];

  const METHODS = {
    signature: 'Signed on screen',
    otp: 'Confirmed with a one-time code sent to their phone',
    paper: 'Signed paper form (scan attached)',
    thumbprint: 'Thumbprint on a paper form, with a witness',
    witness: 'Accessible consent explained and witnessed',
    'in-person': 'Told the clinician in person',
    phone: 'Said so by phone',
    written: 'In writing (letter, email or message)',
    legacy: 'Recorded before the consent ledger (no evidence kept)'
  };

  const ACTIONS = { grant: 'Agreed', refuse: 'Declined', withdraw: 'Withdrawn' };

  /* ---------- versioned notices ---------- */

  const LANGUAGES = {
    en: { name: 'English', voice: 'en-IN' },
    ta: { name: 'தமிழ் (Tamil)', voice: 'ta-IN' },
    hi: { name: 'हिन्दी (Hindi)', voice: 'hi-IN' },
    ml: { name: 'മലയാളം (Malayalam)', voice: 'ml-IN' },
    kn: { name: 'ಕನ್ನಡ (Kannada)', voice: 'kn-IN' },
    sv: { name: 'Svenska (Swedish)', voice: 'sv-SE' }
  };

  /*
   * Notice text. Status per language: 'draft' = clinical and legal wording still to be reviewed; 'draft-translation' = machine-assisted,
   * not yet checked by a qualified translator; 'approved' = reviewed and in use. Only approved text should be relied on with real patients.
   * Each purpose has `text` (standard) and `simple` (short sentences for the accessible mode).
   */
  const NOTICES = {
    current: '1.0',
    versions: {
      '1.0': {
        effective: '2026-11-01',
        languages: {
          en: {
            status: 'draft',
            title: 'How we care for you and use your information',
            intro: '{clinic} provides speech and language assessment and therapy. Before we start, we ask what you agree to. You can say yes to some things and no to others. Saying no to the optional uses below does not change your care.',
            clinicalHead: 'Consent to assessment and therapy',
            dataHead: 'How we use your information',
            purposes: {
              treatment: { label: 'Assessment and therapy', text: 'A speech and language therapist assesses and treats the patient. They will explain each step, and you can ask questions or stop at any time.', simple: 'We will check speech and language and help with therapy. You can stop any time.' },
              records: { label: 'Keeping records to provide care', text: 'We keep notes, goals, session records and reports so that care is safe and continuous. Only the people caring for the patient can see them. We send a short summary to the professional who referred you. We keep them for {years} years after therapy ends, or longer only if a law requires it.', simple: 'We write notes about therapy. Only your therapists see them.' },
              students: { label: 'Student clinicians, supervised', text: 'Student speech and language therapists may assess or treat the patient under the supervision of a qualified therapist, and see the notes they need.', simple: 'A student may help, with a teacher watching.' },
              reports: { label: 'Progress reports to the family', text: 'We may send short session summaries and progress reports to the contact you give us, through a secure link.', simple: 'We may send you short reports.' },
              reminders: { label: 'Appointment reminders', text: 'We may send appointment reminders by SMS, email or WhatsApp Business. They contain only the clinic name, date, time and a link, never health details.', simple: 'We may send a message to remind you of the time.' },
              teaching: { label: 'Pseudonymised use in teaching', text: 'Students may use the case in coursework and teaching, with the name replaced by a case code and initials. Others could sometimes still recognise a case, so we ask separately.', simple: 'Students may learn from this case. We hide the name.' }
            },
            rights: 'You can see your information, ask us to correct it, and withdraw any agreement at any time by telling us. Withdrawing does not undo what was done before. To ask a question or complain, contact {contact}. You can also complain to {authority}.',
            signHere: 'I have read or been told this information, and my answers above are my choice.'
          },
          ta: {
            status: 'draft-translation',
            title: 'உங்களுக்கான சிகிச்சையும் உங்கள் தகவல் பயன்பாடும்',
            intro: '{clinic} பேச்சு மற்றும் மொழி மதிப்பீடு, சிகிச்சை வழங்குகிறது. தொடங்கும் முன் நீங்கள் எதற்கு ஒப்புக்கொள்கிறீர்கள் என்று கேட்கிறோம். சிலவற்றுக்கு ஆம், சிலவற்றுக்கு இல்லை என்று சொல்லலாம். விருப்பப் பயன்பாடுகளுக்கு இல்லை என்று சொன்னாலும் உங்கள் சிகிச்சை மாறாது.',
            clinicalHead: 'மதிப்பீடு மற்றும் சிகிச்சைக்கான ஒப்புதல்',
            dataHead: 'உங்கள் தகவலை எப்படிப் பயன்படுத்துகிறோம்',
            purposes: {
              treatment: { label: 'மதிப்பீடு மற்றும் சிகிச்சை', text: 'பேச்சு மற்றும் மொழி சிகிச்சையாளர் மதிப்பீடு செய்து சிகிச்சை அளிப்பார். ஒவ்வொரு படியையும் விளக்குவார்; எப்போது வேண்டுமானாலும் கேள்வி கேட்கலாம் அல்லது நிறுத்தலாம்.', simple: 'பேச்சையும் மொழியையும் பார்த்து சிகிச்சை தருவோம். எப்போது வேண்டுமானாலும் நிறுத்தலாம்.' },
              records: { label: 'சிகிச்சைக்காகப் பதிவுகளை வைத்திருத்தல்', text: 'பாதுகாப்பான, தொடர்ச்சியான சிகிச்சைக்காகக் குறிப்புகள், இலக்குகள், அமர்வுப் பதிவுகள், அறிக்கைகளை வைத்திருக்கிறோம். சிகிச்சை அளிப்பவர்கள் மட்டுமே பார்க்க முடியும். உங்களைப் பரிந்துரைத்தவருக்குச் சுருக்கமான தகவல் அனுப்புவோம். சிகிச்சை முடிந்த பின் {years} ஆண்டுகள் வைத்திருப்போம்.', simple: 'சிகிச்சை பற்றிக் குறிப்பு எழுதுவோம். உங்கள் சிகிச்சையாளர்கள் மட்டுமே பார்ப்பார்கள்.' },
              students: { label: 'மேற்பார்வையில் மாணவர் சிகிச்சையாளர்கள்', text: 'தகுதி பெற்ற சிகிச்சையாளரின் மேற்பார்வையில் மாணவர்கள் மதிப்பீடு அல்லது சிகிச்சை செய்யலாம், தேவையான குறிப்புகளைப் பார்க்கலாம்.', simple: 'ஆசிரியர் பார்த்துக்கொண்டிருக்க, ஒரு மாணவர் உதவலாம்.' },
              reports: { label: 'குடும்பத்திற்கு முன்னேற்ற அறிக்கைகள்', text: 'நீங்கள் தரும் தொடர்புக்குப் பாதுகாப்பான இணைப்பு மூலம் சுருக்கமான அறிக்கைகளை அனுப்பலாம்.', simple: 'உங்களுக்குச் சிறிய அறிக்கைகள் அனுப்பலாம்.' },
              reminders: { label: 'சந்திப்பு நினைவூட்டல்கள்', text: 'SMS அல்லது WhatsApp Business மூலம் நினைவூட்டல் அனுப்பலாம். அதில் மருத்துவமனைப் பெயர், தேதி, நேரம், இணைப்பு மட்டுமே இருக்கும்; உடல்நலத் தகவல் இருக்காது.', simple: 'நேரத்தை நினைவூட்டச் செய்தி அனுப்பலாம்.' },
              teaching: { label: 'பெயர் மறைத்துக் கற்பித்தலில் பயன்பாடு', text: 'பெயருக்குப் பதிலாக வழக்குக் குறியீடும் முதலெழுத்துகளும் கொண்டு மாணவர்கள் பாடப்பணியிலும் கற்பித்தலிலும் பயன்படுத்தலாம். சில நேரம் மற்றவர்கள் அடையாளம் காணக்கூடும் என்பதால் தனியாகக் கேட்கிறோம்.', simple: 'மாணவர்கள் இந்த வழக்கிலிருந்து கற்கலாம். பெயரை மறைப்போம்.' }
            },
            rights: 'உங்கள் தகவலைப் பார்க்கலாம், திருத்தக் கேட்கலாம், எந்த ஒப்புதலையும் எப்போது வேண்டுமானாலும் திரும்பப் பெறலாம். கேள்வி அல்லது புகாருக்கு {contact} ஐத் தொடர்புகொள்ளுங்கள். இந்தியத் தரவுப் பாதுகாப்பு வாரியத்திடமும் புகார் செய்யலாம்.',
            signHere: 'இந்தத் தகவலைப் படித்தேன் அல்லது எனக்கு விளக்கப்பட்டது; மேலே உள்ள பதில்கள் என் விருப்பம்.'
          },
          hi: {
            status: 'draft-translation',
            title: 'आपका इलाज और आपकी जानकारी का उपयोग',
            intro: '{clinic} बोलने और भाषा की जाँच और थेरेपी देता है। शुरू करने से पहले हम पूछते हैं कि आप किन बातों के लिए सहमत हैं। आप कुछ के लिए हाँ और कुछ के लिए ना कह सकते हैं। नीचे दिए वैकल्पिक उपयोगों के लिए ना कहने से आपके इलाज पर कोई असर नहीं पड़ता।',
            clinicalHead: 'जाँच और थेरेपी के लिए सहमति',
            dataHead: 'हम आपकी जानकारी का उपयोग कैसे करते हैं',
            purposes: {
              treatment: { label: 'जाँच और थेरेपी', text: 'स्पीच और लैंग्वेज थेरेपिस्ट जाँच करेंगे और थेरेपी देंगे। वे हर कदम समझाएँगे; आप कभी भी सवाल पूछ सकते हैं या रोक सकते हैं।', simple: 'हम बोलने और भाषा की जाँच करेंगे और थेरेपी देंगे। आप कभी भी रोक सकते हैं।' },
              records: { label: 'इलाज के लिए रिकॉर्ड रखना', text: 'सुरक्षित और लगातार इलाज के लिए हम नोट्स, लक्ष्य, सत्र रिकॉर्ड और रिपोर्ट रखते हैं। सिर्फ़ इलाज करने वाले लोग इन्हें देख सकते हैं। आपको भेजने वाले विशेषज्ञ को हम एक छोटा सारांश भेजते हैं। थेरेपी खत्म होने के बाद हम इन्हें {years} साल तक रखते हैं।', simple: 'हम थेरेपी के नोट्स लिखते हैं। सिर्फ़ आपके थेरेपिस्ट देखते हैं।' },
              students: { label: 'निगरानी में छात्र थेरेपिस्ट', text: 'योग्य थेरेपिस्ट की निगरानी में छात्र जाँच या थेरेपी कर सकते हैं और ज़रूरी नोट्स देख सकते हैं।', simple: 'शिक्षक की निगरानी में एक छात्र मदद कर सकता है।' },
              reports: { label: 'परिवार को प्रगति रिपोर्ट', text: 'आपके दिए संपर्क पर हम सुरक्षित लिंक से छोटी रिपोर्ट भेज सकते हैं।', simple: 'हम आपको छोटी रिपोर्ट भेज सकते हैं।' },
              reminders: { label: 'अपॉइंटमेंट रिमाइंडर', text: 'हम SMS या WhatsApp Business से रिमाइंडर भेज सकते हैं। उनमें सिर्फ़ क्लिनिक का नाम, तारीख, समय और लिंक होगा, स्वास्थ्य की कोई जानकारी नहीं।', simple: 'समय याद दिलाने के लिए हम संदेश भेज सकते हैं।' },
              teaching: { label: 'नाम छिपाकर पढ़ाई में उपयोग', text: 'नाम की जगह केस कोड और आद्याक्षर लिखकर छात्र इस केस को कोर्सवर्क और पढ़ाई में उपयोग कर सकते हैं। कभी-कभी फिर भी कोई पहचान सकता है, इसलिए हम अलग से पूछते हैं।', simple: 'छात्र इस केस से सीख सकते हैं। हम नाम छिपाएँगे।' }
            },
            rights: 'आप अपनी जानकारी देख सकते हैं, उसे ठीक करवा सकते हैं, और कोई भी सहमति कभी भी वापस ले सकते हैं। सवाल या शिकायत के लिए {contact} से संपर्क करें। आप भारत के डेटा संरक्षण बोर्ड से भी शिकायत कर सकते हैं।',
            signHere: 'मैंने यह जानकारी पढ़ी है या मुझे समझाई गई है, और ऊपर दिए उत्तर मेरी अपनी पसंद हैं।'
          },
          ml: {
            status: 'draft-translation',
            title: 'നിങ്ങളുടെ ചികിത്സയും നിങ്ങളുടെ വിവരങ്ങളുടെ ഉപയോഗവും',
            intro: '{clinic} സംസാര-ഭാഷാ പരിശോധനയും തെറാപ്പിയും നൽകുന്നു. തുടങ്ങുന്നതിനു മുൻപ് നിങ്ങൾ എന്തിനൊക്കെ സമ്മതിക്കുന്നു എന്ന് ഞങ്ങൾ ചോദിക്കുന്നു. ചിലതിന് അതെ എന്നും ചിലതിന് ഇല്ല എന്നും പറയാം. ഐച്ഛിക ഉപയോഗങ്ങൾക്ക് ഇല്ല എന്നു പറഞ്ഞാലും ചികിത്സ മാറില്ല.',
            clinicalHead: 'പരിശോധനയ്ക്കും തെറാപ്പിക്കുമുള്ള സമ്മതം',
            dataHead: 'നിങ്ങളുടെ വിവരങ്ങൾ ഞങ്ങൾ എങ്ങനെ ഉപയോഗിക്കുന്നു',
            purposes: {
              treatment: { label: 'പരിശോധനയും തെറാപ്പിയും', text: 'സ്പീച്ച്-ലാംഗ്വേജ് തെറാപ്പിസ്റ്റ് പരിശോധിക്കുകയും ചികിത്സിക്കുകയും ചെയ്യും. ഓരോ ഘട്ടവും വിശദീകരിക്കും; എപ്പോൾ വേണമെങ്കിലും ചോദിക്കാം, നിർത്താം.', simple: 'സംസാരവും ഭാഷയും പരിശോധിച്ച് തെറാപ്പി നൽകും. എപ്പോൾ വേണമെങ്കിലും നിർത്താം.' },
              records: { label: 'ചികിത്സയ്ക്കായി രേഖകൾ സൂക്ഷിക്കൽ', text: 'സുരക്ഷിതവും തുടർച്ചയുള്ളതുമായ ചികിത്സയ്ക്കായി കുറിപ്പുകളും ലക്ഷ്യങ്ങളും റിപ്പോർട്ടുകളും സൂക്ഷിക്കുന്നു. ചികിത്സിക്കുന്നവർക്കു മാത്രമേ കാണാൻ കഴിയൂ. നിങ്ങളെ റഫർ ചെയ്ത വിദഗ്ധന് ഞങ്ങൾ ഒരു ചെറിയ സംഗ്രഹം അയയ്ക്കും. തെറാപ്പി കഴിഞ്ഞ് {years} വർഷം സൂക്ഷിക്കും.', simple: 'തെറാപ്പിയെക്കുറിച്ച് കുറിപ്പുകൾ എഴുതും. നിങ്ങളുടെ തെറാപ്പിസ്റ്റുകൾ മാത്രം കാണും.' },
              students: { label: 'മേൽനോട്ടത്തിൽ വിദ്യാർത്ഥി തെറാപ്പിസ്റ്റുകൾ', text: 'യോഗ്യതയുള്ള തെറാപ്പിസ്റ്റിന്റെ മേൽനോട്ടത്തിൽ വിദ്യാർത്ഥികൾ പരിശോധനയോ തെറാപ്പിയോ ചെയ്യുകയും ആവശ്യമായ കുറിപ്പുകൾ കാണുകയും ചെയ്യാം.', simple: 'അധ്യാപകൻ നോക്കിനിൽക്കെ ഒരു വിദ്യാർത്ഥി സഹായിച്ചേക്കാം.' },
              reports: { label: 'കുടുംബത്തിന് പുരോഗതി റിപ്പോർട്ടുകൾ', text: 'നിങ്ങൾ തരുന്ന വിലാസത്തിലേക്ക് സുരക്ഷിത ലിങ്ക് വഴി ചെറിയ റിപ്പോർട്ടുകൾ അയച്ചേക്കാം.', simple: 'നിങ്ങൾക്ക് ചെറിയ റിപ്പോർട്ടുകൾ അയച്ചേക്കാം.' },
              reminders: { label: 'അപ്പോയിന്റ്മെന്റ് ഓർമ്മപ്പെടുത്തലുകൾ', text: 'SMS അല്ലെങ്കിൽ WhatsApp Business വഴി ഓർമ്മപ്പെടുത്തൽ അയച്ചേക്കാം. അതിൽ ക്ലിനിക്കിന്റെ പേര്, തീയതി, സമയം, ലിങ്ക് മാത്രം; ആരോഗ്യ വിവരങ്ങൾ ഇല്ല.', simple: 'സമയം ഓർമ്മിപ്പിക്കാൻ സന്ദേശം അയച്ചേക്കാം.' },
              teaching: { label: 'പേര് മറച്ച് പഠനത്തിൽ ഉപയോഗം', text: 'പേരിനു പകരം കേസ് കോഡും ഇനിഷ്യലുകളും ഉപയോഗിച്ച് വിദ്യാർത്ഥികൾ ഈ കേസ് പഠനത്തിൽ ഉപയോഗിച്ചേക്കാം. ചിലപ്പോൾ മറ്റുള്ളവർ തിരിച്ചറിഞ്ഞേക്കാം, അതിനാൽ വേറെ ചോദിക്കുന്നു.', simple: 'വിദ്യാർത്ഥികൾ ഈ കേസിൽ നിന്ന് പഠിച്ചേക്കാം. പേര് മറയ്ക്കും.' }
            },
            rights: 'നിങ്ങളുടെ വിവരങ്ങൾ കാണാനും തിരുത്താൻ ആവശ്യപ്പെടാനും ഏതു സമ്മതവും എപ്പോൾ വേണമെങ്കിലും പിൻവലിക്കാനും കഴിയും. ചോദ്യങ്ങൾക്കും പരാതികൾക്കും {contact} നെ ബന്ധപ്പെടുക. ഇന്ത്യയിലെ ഡാറ്റ പ്രൊട്ടക്ഷൻ ബോർഡിനും പരാതി നൽകാം.',
            signHere: 'ഈ വിവരം ഞാൻ വായിച്ചു അല്ലെങ്കിൽ എനിക്ക് വിശദീകരിച്ചു തന്നു; മുകളിലെ ഉത്തരങ്ങൾ എന്റെ തീരുമാനമാണ്.'
          },
          kn: {
            status: 'draft-translation',
            title: 'ನಿಮ್ಮ ಚಿಕಿತ್ಸೆ ಮತ್ತು ನಿಮ್ಮ ಮಾಹಿತಿಯ ಬಳಕೆ',
            intro: '{clinic} ಮಾತು ಮತ್ತು ಭಾಷೆಯ ಪರೀಕ್ಷೆ ಮತ್ತು ಥೆರಪಿ ನೀಡುತ್ತದೆ. ಪ್ರಾರಂಭಿಸುವ ಮೊದಲು ನೀವು ಯಾವುದಕ್ಕೆ ಒಪ್ಪುತ್ತೀರಿ ಎಂದು ಕೇಳುತ್ತೇವೆ. ಕೆಲವಕ್ಕೆ ಹೌದು, ಕೆಲವಕ್ಕೆ ಇಲ್ಲ ಎನ್ನಬಹುದು. ಐಚ್ಛಿಕ ಬಳಕೆಗಳಿಗೆ ಇಲ್ಲ ಎಂದರೂ ನಿಮ್ಮ ಚಿಕಿತ್ಸೆ ಬದಲಾಗುವುದಿಲ್ಲ.',
            clinicalHead: 'ಪರೀಕ್ಷೆ ಮತ್ತು ಥೆರಪಿಗೆ ಒಪ್ಪಿಗೆ',
            dataHead: 'ನಿಮ್ಮ ಮಾಹಿತಿಯನ್ನು ನಾವು ಹೇಗೆ ಬಳಸುತ್ತೇವೆ',
            purposes: {
              treatment: { label: 'ಪರೀಕ್ಷೆ ಮತ್ತು ಥೆರಪಿ', text: 'ಸ್ಪೀಚ್ ಮತ್ತು ಲ್ಯಾಂಗ್ವೇಜ್ ಥೆರಪಿಸ್ಟ್ ಪರೀಕ್ಷಿಸಿ ಚಿಕಿತ್ಸೆ ನೀಡುತ್ತಾರೆ. ಪ್ರತಿ ಹಂತವನ್ನು ವಿವರಿಸುತ್ತಾರೆ; ಯಾವಾಗ ಬೇಕಾದರೂ ಪ್ರಶ್ನೆ ಕೇಳಬಹುದು ಅಥವಾ ನಿಲ್ಲಿಸಬಹುದು.', simple: 'ಮಾತು ಮತ್ತು ಭಾಷೆಯನ್ನು ಪರೀಕ್ಷಿಸಿ ಥೆರಪಿ ನೀಡುತ್ತೇವೆ. ಯಾವಾಗ ಬೇಕಾದರೂ ನಿಲ್ಲಿಸಬಹುದು.' },
              records: { label: 'ಚಿಕಿತ್ಸೆಗಾಗಿ ದಾಖಲೆಗಳನ್ನು ಇಡುವುದು', text: 'ಸುರಕ್ಷಿತ ಮತ್ತು ನಿರಂತರ ಚಿಕಿತ್ಸೆಗಾಗಿ ಟಿಪ್ಪಣಿಗಳು, ಗುರಿಗಳು, ವರದಿಗಳನ್ನು ಇಡುತ್ತೇವೆ. ಚಿಕಿತ್ಸೆ ನೀಡುವವರು ಮಾತ್ರ ನೋಡಬಹುದು. ನಿಮ್ಮನ್ನು ಕಳುಹಿಸಿದ ತಜ್ಞರಿಗೆ ನಾವು ಸಣ್ಣ ಸಾರಾಂಶವನ್ನು ಕಳುಹಿಸುತ್ತೇವೆ. ಥೆರಪಿ ಮುಗಿದ ನಂತರ {years} ವರ್ಷ ಇಡುತ್ತೇವೆ.', simple: 'ಥೆರಪಿಯ ಬಗ್ಗೆ ಟಿಪ್ಪಣಿ ಬರೆಯುತ್ತೇವೆ. ನಿಮ್ಮ ಥೆರಪಿಸ್ಟ್‌ಗಳು ಮಾತ್ರ ನೋಡುತ್ತಾರೆ.' },
              students: { label: 'ಮೇಲ್ವಿಚಾರಣೆಯಲ್ಲಿ ವಿದ್ಯಾರ್ಥಿ ಥೆರಪಿಸ್ಟ್‌ಗಳು', text: 'ಅರ್ಹ ಥೆರಪಿಸ್ಟ್‌ರ ಮೇಲ್ವಿಚಾರಣೆಯಲ್ಲಿ ವಿದ್ಯಾರ್ಥಿಗಳು ಪರೀಕ್ಷೆ ಅಥವಾ ಥೆರಪಿ ಮಾಡಬಹುದು ಮತ್ತು ಅಗತ್ಯ ಟಿಪ್ಪಣಿಗಳನ್ನು ನೋಡಬಹುದು.', simple: 'ಶಿಕ್ಷಕರು ನೋಡುತ್ತಿರುವಾಗ ಒಬ್ಬ ವಿದ್ಯಾರ್ಥಿ ಸಹಾಯ ಮಾಡಬಹುದು.' },
              reports: { label: 'ಕುಟುಂಬಕ್ಕೆ ಪ್ರಗತಿ ವರದಿಗಳು', text: 'ನೀವು ನೀಡುವ ಸಂಪರ್ಕಕ್ಕೆ ಸುರಕ್ಷಿತ ಲಿಂಕ್ ಮೂಲಕ ಸಣ್ಣ ವರದಿಗಳನ್ನು ಕಳುಹಿಸಬಹುದು.', simple: 'ನಿಮಗೆ ಸಣ್ಣ ವರದಿಗಳನ್ನು ಕಳುಹಿಸಬಹುದು.' },
              reminders: { label: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಜ್ಞಾಪನೆಗಳು', text: 'SMS ಅಥವಾ WhatsApp Business ಮೂಲಕ ಜ್ಞಾಪನೆ ಕಳುಹಿಸಬಹುದು. ಅದರಲ್ಲಿ ಕ್ಲಿನಿಕ್ ಹೆಸರು, ದಿನಾಂಕ, ಸಮಯ ಮತ್ತು ಲಿಂಕ್ ಮಾತ್ರ; ಆರೋಗ್ಯ ಮಾಹಿತಿ ಇರುವುದಿಲ್ಲ.', simple: 'ಸಮಯ ನೆನಪಿಸಲು ಸಂದೇಶ ಕಳುಹಿಸಬಹುದು.' },
              teaching: { label: 'ಹೆಸರು ಮರೆಮಾಡಿ ಬೋಧನೆಯಲ್ಲಿ ಬಳಕೆ', text: 'ಹೆಸರಿನ ಬದಲು ಕೇಸ್ ಕೋಡ್ ಮತ್ತು ಇನಿಷಿಯಲ್‌ಗಳನ್ನು ಬಳಸಿ ವಿದ್ಯಾರ್ಥಿಗಳು ಈ ಕೇಸನ್ನು ಕಲಿಕೆಯಲ್ಲಿ ಬಳಸಬಹುದು. ಕೆಲವೊಮ್ಮೆ ಇತರರು ಗುರುತಿಸಬಹುದು, ಆದ್ದರಿಂದ ಪ್ರತ್ಯೇಕವಾಗಿ ಕೇಳುತ್ತೇವೆ.', simple: 'ವಿದ್ಯಾರ್ಥಿಗಳು ಈ ಕೇಸಿನಿಂದ ಕಲಿಯಬಹುದು. ಹೆಸರನ್ನು ಮರೆಮಾಡುತ್ತೇವೆ.' }
            },
            rights: 'ನಿಮ್ಮ ಮಾಹಿತಿಯನ್ನು ನೋಡಬಹುದು, ತಿದ್ದಲು ಕೇಳಬಹುದು, ಯಾವುದೇ ಒಪ್ಪಿಗೆಯನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ ಹಿಂಪಡೆಯಬಹುದು. ಪ್ರಶ್ನೆ ಅಥವಾ ದೂರಿಗೆ {contact} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ. ಭಾರತದ ಡೇಟಾ ಸಂರಕ್ಷಣಾ ಮಂಡಳಿಗೂ ದೂರು ನೀಡಬಹುದು.',
            signHere: 'ಈ ಮಾಹಿತಿಯನ್ನು ನಾನು ಓದಿದ್ದೇನೆ ಅಥವಾ ನನಗೆ ವಿವರಿಸಲಾಗಿದೆ; ಮೇಲಿನ ಉತ್ತರಗಳು ನನ್ನ ಆಯ್ಕೆ.'
          },
          sv: {
            status: 'draft-translation',
            title: 'Hur vi tar hand om dig och använder dina uppgifter',
            intro: '{clinic} gör bedömningar och ger behandling inom tal och språk (logopedi). Innan vi börjar frågar vi vad du samtycker till. Du kan säga ja till vissa saker och nej till andra. Att säga nej till de frivilliga delarna nedan påverkar inte din vård.',
            clinicalHead: 'Samtycke till bedömning och behandling',
            dataHead: 'Hur vi använder dina uppgifter',
            purposes: {
              treatment: { label: 'Bedömning och behandling', text: 'En logoped bedömer och behandlar patienten. Logopeden förklarar varje steg, och du kan ställa frågor eller avbryta när som helst.', simple: 'Vi undersöker tal och språk och ger behandling. Du kan sluta när du vill.' },
              records: { label: 'Journal för att ge vård', text: 'Vi för anteckningar, mål, besöksanteckningar och rapporter så att vården blir säker och sammanhängande. Bara de som vårdar patienten kan se dem. Vi skickar en kort sammanfattning till den som remitterade dig. Vi sparar dem i {years} år efter avslutad behandling, eller längre om lagen kräver det.', simple: 'Vi skriver anteckningar om behandlingen. Bara dina logopeder ser dem.' },
              students: { label: 'Studenter under handledning', text: 'Logopedstudenter kan bedöma eller behandla patienten under handledning av en legitimerad logoped och läsa de anteckningar de behöver.', simple: 'En student kan hjälpa till, med en lärare bredvid.' },
              reports: { label: 'Rapporter till familjen', text: 'Vi kan skicka korta sammanfattningar och rapporter till den kontakt du anger, via en säker länk.', simple: 'Vi kan skicka korta rapporter till dig.' },
              reminders: { label: 'Påminnelser om besök', text: 'Vi kan skicka påminnelser via sms, e-post eller WhatsApp Business. De innehåller bara mottagningens namn, datum, tid och en länk, aldrig hälsouppgifter.', simple: 'Vi kan skicka ett meddelande som påminner om tiden.' },
              teaching: { label: 'Pseudonymiserad användning i undervisning', text: 'Studenter kan använda fallet i kursarbete och undervisning, med namnet ersatt av en kod och initialer. Andra kan ibland ändå känna igen ett fall, därför frågar vi separat.', simple: 'Studenter kan lära sig av fallet. Vi döljer namnet.' }
            },
            rights: 'Du kan ta del av dina uppgifter, be oss rätta dem och när som helst återkalla ett samtycke genom att säga till. Ett återkallat samtycke gäller framåt. Frågor eller klagomål: kontakta {contact}. Du kan också klaga hos {authority}.',
            signHere: 'Jag har läst eller fått denna information förklarad, och mina svar ovan är mina egna val.'
          }
        }
      }
    }
  };

  const STATUS_LABEL = { approved: 'Approved', draft: 'Draft: clinical and legal wording to be reviewed', 'draft-translation': 'Draft translation: not yet checked by a qualified translator' };

  function fill(str, vars) { return String(str || '').replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; }); }

  /* The notice in one language, falling back to English for anything missing. */
  function notice(lang, version, vars) {
    const v = NOTICES.versions[version || NOTICES.current];
    const en = v.languages.en, t = v.languages[lang] || en;
    const purposes = {};
    PURPOSES.forEach(function (p) {
      const a = (t.purposes || {})[p.id] || en.purposes[p.id];
      purposes[p.id] = { label: fill(a.label, vars), text: fill(a.text, vars), simple: fill(a.simple, vars) };
    });
    const pick = function (k) { return fill(t[k] || en[k], vars); };
    return { version: version || NOTICES.current, effective: v.effective, lang: v.languages[lang] ? lang : 'en', status: t.status, statusLabel: STATUS_LABEL[t.status] || t.status,
      title: pick('title'), intro: pick('intro'), clinicalHead: pick('clinicalHead'), dataHead: pick('dataHead'), rights: pick('rights'), signHere: pick('signHere'), purposes: purposes };
  }

  /* ---------- the ledger ---------- */

  // What the seal covers: everything except the seal itself.
  function body(e) {
    const o = {};
    Object.keys(e).sort().forEach(function (k) { if (k !== 'hash') o[k] = e[k]; });
    return JSON.stringify(o);
  }
  // Pictures (signature, scan) are sealed by their own hash so the chain can be checked without them.
  function evidenceDigest(ev) {
    const o = {};
    Object.keys(ev || {}).sort().forEach(function (k) {
      const v = ev[k];
      o[k] = typeof v === 'string' && v.indexOf('data:') === 0 ? 'sha256:' + sha256(v) : v;
    });
    return o;
  }

  function forPatient(entries, pid) {
    return entries.filter(function (e) { return e.patientId === pid; }).sort(function (a, b) { return a.seq - b.seq || a.at.localeCompare(b.at); });
  }

  /*
   * A new ledger entry, sealed onto the end of this patient's chain.
   * decisions: [{ purpose, action: grant | refuse | withdraw }]
   */
  function makeEntry(entries, f) {
    const chain = forPatient(entries, f.patientId), last = chain[chain.length - 1];
    const e = {
      id: f.id || 'con_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      patientId: f.patientId, seq: last ? last.seq + 1 : 1, at: f.at || new Date().toISOString(),
      decisions: f.decisions.map(function (d) { return { purpose: d.purpose, action: d.action }; }),
      giver: { name: f.giver.name, relationship: f.giver.relationship, basis: f.giver.basis || '', basisRef: f.giver.basisRef || '' },
      recordedBy: f.recordedBy, notice: { version: f.noticeVersion || NOTICES.current }, language: f.language || 'en',
      method: f.method, accessible: !!f.accessible, note: f.note || '',
      evidence: f.evidence || {}, evidenceDigest: evidenceDigest(f.evidence),
      receiptId: f.receiptId || 'CR-' + (f.at || new Date().toISOString()).slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
      prev: last ? last.hash : ''
    };
    if (f.demo) e.demo = true;
    // Evidence pictures are not hashed twice: the seal covers their digest.
    const sealed = Object.assign({}, e, { evidence: undefined });
    delete sealed.evidence;
    e.hash = sha256(body(sealed));
    return e;
  }

  /* Recompute every seal. Returns { ok, problems:[...] }. */
  function verify(entries, pid) {
    const chain = forPatient(entries, pid), problems = [];
    let prev = '';
    chain.forEach(function (e, i) {
      const sealed = Object.assign({}, e);
      delete sealed.evidence;
      if (sha256(body(sealed)) !== e.hash) problems.push('Entry ' + (i + 1) + ' (' + e.receiptId + ') was changed after it was sealed');
      if (e.prev !== prev) problems.push('Entry ' + (i + 1) + ' does not follow the one before it');
      const now = evidenceDigest(e.evidence);
      Object.keys(now).forEach(function (k) { if (JSON.stringify(now[k]) !== JSON.stringify((e.evidenceDigest || {})[k])) problems.push('Evidence "' + k + '" in entry ' + (i + 1) + ' was changed'); });
      prev = e.hash;
    });
    return { ok: !problems.length, problems: problems, count: chain.length };
  }

  /* Where each purpose stands now: { purpose: { action, at, entry } }. */
  function current(entries, pid) {
    const out = {};
    forPatient(entries, pid).forEach(function (e) {
      e.decisions.forEach(function (d) { out[d.purpose] = { action: d.action, at: e.at, entry: e }; });
    });
    return out;
  }

  /* The yes/no flags the rest of the app checks (patient.consent). */
  function flags(entries, pid) {
    const cur = current(entries, pid), chain = forPatient(entries, pid), last = chain[chain.length - 1];
    const f = { recordedOn: last ? last.at.slice(0, 10) : '', givenBy: last ? RELATIONSHIPS[last.giver.relationship] || '' : '', ledger: true };
    PURPOSES.forEach(function (p) { f[p.flag] = !!cur[p.id] && cur[p.id].action === 'grant'; });
    return f;
  }

  function ageOn(dob, iso) {
    if (!dob) return null;
    const b = new Date(dob + 'T00:00:00'), d = new Date((iso || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
    let a = d.getFullYear() - b.getFullYear();
    if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--;
    return a;
  }

  /* Reasons to ask again: turned 18, guardian changed, a new purpose, a new notice version, or nothing in the ledger. */
  function reviewNeeded(p, entries, today, adultAge) {
    const chain = forPatient(entries, p.id), last = chain[chain.length - 1], cur = current(entries, p.id), out = [];
    if (!last) return [{ code: 'none', text: 'No consent recorded in the ledger yet' }];
    if (chain.every(function (e) { return e.method === 'legacy'; })) out.push({ code: 'legacy', text: 'Recorded before the consent ledger: ask again with a notice' });
    const giverForChild = last.giver.relationship === 'parent' || last.giver.relationship === 'guardian';
    const age = ageOn(p.dob, today);
    const adult = adultAge || 18;
    if (giverForChild && age != null && age >= adult) out.push({ code: 'adult', text: 'Turned ' + adult + ': ask the patient themselves' });
    if (giverForChild && p.guardian && last.giver.name && p.guardian.trim().toLowerCase() !== last.giver.name.trim().toLowerCase()) out.push({ code: 'guardian', text: 'Guardian changed (consent was given by ' + last.giver.name + ')' });
    PURPOSES.forEach(function (pp) { if (!cur[pp.id]) out.push({ code: 'purpose', purpose: pp.id, text: 'Not asked yet: ' + notice('en').purposes[pp.id].label }); });
    const major = function (v) { return Number(String(v || '0').split('.')[0]); };
    if (major(last.notice && last.notice.version) < major(NOTICES.current)) out.push({ code: 'notice', text: 'Privacy notice updated (v' + last.notice.version + ' → v' + NOTICES.current + ')' });
    return out;
  }

  /* Plain-text receipt for the person who gave consent. */
  function receiptText(e, n, ctx) {
    const lines = [ctx.clinic + ' – consent receipt ' + e.receiptId, '',
      'Patient: ' + ctx.patient, 'Given by: ' + e.giver.name + ' (' + (RELATIONSHIPS[e.giver.relationship] || e.giver.relationship) + ')' + (e.giver.basis ? ', ' + e.giver.basis + (e.giver.basisRef ? ' ' + e.giver.basisRef : '') : ''),
      'Date: ' + new Date(e.at).toLocaleString(), 'Notice: version ' + e.notice.version + ', ' + (LANGUAGES[e.language] || LANGUAGES.en).name, 'How: ' + (METHODS[e.method] || e.method), ''];
    e.decisions.forEach(function (d) { lines.push((ACTIONS[d.action] || d.action) + ': ' + n.purposes[d.purpose].label); });
    lines.push('', n.rights, '', 'Seal: ' + e.hash);
    return lines.join('\n');
  }

  const api = {
    sha256: sha256, PURPOSES: PURPOSES, RELATIONSHIPS: RELATIONSHIPS, ON_BEHALF: ON_BEHALF, GUARDIAN_BASIS: GUARDIAN_BASIS, METHODS: METHODS, ACTIONS: ACTIONS,
    LANGUAGES: LANGUAGES, NOTICES: NOTICES, notice: notice, makeEntry: makeEntry, verify: verify, current: current, flags: flags, forPatient: forPatient,
    reviewNeeded: reviewNeeded, receiptText: receiptText, ageOn: ageOn
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Consent = api;
})(typeof window !== 'undefined' ? window : this);
