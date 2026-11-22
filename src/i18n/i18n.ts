export type Language = 'de' | 'en';

const STORAGE_KEY = 'surfsk8.lang';

const EN_TRANSLATIONS = {
  // App & Loader
  'app.title': 'SRFSK8 — Level 1: Skatepark "Im Wiesengrund"',
  'loader.text': 'Loading SRFSK8 Game',

  // Common
  'common.close': 'CLOSE',
  'common.done': 'DONE',
  'common.save': '🏆 SAVE',

  // Landing Top Utility Nav
  'nav.leaderboard': 'TOP SCORES',
  'nav.leaderboardTitle': 'Global Top Scores / Leaderboard',
  'nav.soundTitle': 'Toggle Sound / Music [M]',
  'nav.soundOn': 'SOUND: ON',
  'nav.soundOff': 'SOUND: OFF',
  'nav.qualityTitle': 'Toggle Graphics Quality [Q]',
  'nav.qualityLabel': 'QUALITY: {label}',
  'nav.fullscreenTitle': 'Toggle Fullscreen',
  'nav.fullscreen': 'FULLSCREEN',
  'nav.exitFullscreen': 'EXIT FULLSCREEN',
  'nav.help': 'CONTROLS',
  'nav.helpTitle': 'Controls & Help',
  'nav.terms': 'IMPRESSUM / PRIVACY',
  'nav.termsTitle': 'Impressum & Privacy Policy',
  'nav.langTitle': 'Switch Language: Deutsch / English',
  'nav.settings': 'SETTINGS',
  'nav.settingsTitle': 'Settings & Menu',
  'nav.settingsMenuTitle': 'SETTINGS & PREFERENCES',
  'nav.soundMenuLabel': 'Sound & Music',
  'nav.qualityMenuLabel': 'Graphics',
  'nav.fullscreenMenuLabel': 'Fullscreen',
  'nav.langMenuLabel': 'Language',
  'nav.tutorialMenuLabel': 'Tutorial',
  'nav.tutorialTitle': 'Start Interactive Tutorial',
  'nav.termsMenuLabel': 'Legal & Privacy',
  'nav.stateOn': 'ON',
  'nav.stateOff': 'OFF',

  // Landing Setup & Mode
  'landing.setup': 'SETUP',
  'landing.skater': 'SKATER',
  'landing.skatepark': 'SKATEPARK',
  'landing.board': 'BOARD',
  'landing.moreToCome': 'MORE TO COME!',
  'landing.noticePark':
    'Tell us on <a href="https://www.instagram.com/surfskate_munich/" target="_blank" rel="noopener noreferrer">@surfskate_munich</a> which <strong>skatepark</strong> you want to see next!',
  'landing.noticeBoard':
    'Tell us on <a href="https://www.instagram.com/surfskate_munich/" target="_blank" rel="noopener noreferrer">@surfskate_munich</a> which <strong>board</strong> you want to see next!',
  'landing.showPhoto': 'Show photo',
  'landing.showBoard': 'Show board icon',
  'landing.view3d': '🔍 3D VIEW',
  'landing.view3dTitle': 'Inspect 3D Park',
  'landing.riderLabel': '🏷️ RIDER',
  'landing.riderPlaceholder': 'Rider Name (Leaderboard)',
  'landing.gameMode': 'GAME MODE',
  'landing.modeJam': '2-MIN JAM',
  'landing.modeFlowCup': 'FLOW CUP',
  'landing.modeZen': 'FREE SURF',
  'landing.dropIn': 'DROP IN',
  'landing.pressEnter': 'PRESS ENTER',
  'landing.challenges': 'CHALLENGES',
  'landing.missionsCount': '{done}/{total} DONE',

  // Game Mode Descriptions
  'mode.jamDesc': '⏱️ 120s Highscore Hunt — Carve hot-spots, land tricks & collect pretzels.',
  'mode.flowCupDesc': '🌊 Follow the Flow — Carve through gates, keep momentum & lock lines.',
  'mode.zenDesc': '🌅 Endless Free Surf — No timer, no stress: cruise the bowl & carve sunset lines.',

  // Leaderboard Modal
  'lb.badge': 'GLOBAL TOP 15 HIGHSCORES',
  'lb.title': '🏆 TOP SCORES',
  'lb.sourceGlobal': 'GLOBAL LIVE',
  'lb.sourceLocal': 'LOCAL PREVIEW',
  'lb.tabAll': '🌍 ALL PARKS',
  'lb.tabWiesengrund': '🌲 IM WIESENGRUND',
  'lb.tabAirport': '✈️ AIRPORT PARK',
  'lb.loading': '⏳ Loading leaderboard...',
  'lb.empty': '🏄 No scores yet — start a 2-min session and claim #1!',
  'lb.youTag': 'YOU',
  'lb.footerHint': 'Each rider keeps their personal best score.',

  // Help & Controls Modal
  'help.badge': 'HOW TO PLAY',
  'help.title': 'CONTROLS & BOWL GUIDE',
  'help.tabMobile': '📱 Touch Controls',
  'help.tabKeyboard': '⌨️ PC Keyboard',
  'help.mobileSectionTitle': '📱 SMARTPHONE / TOUCH CONTROLS',
  'help.mobCarve': '<strong>Carve &amp; Bowl Walls:</strong> Carve the bowl walls &amp; build momentum',
  'help.mobPump': '<strong>Gain Speed:</strong> Push off from standstill &amp; pump in transitions',
  'help.mobBrake': '<strong>Slow Down:</strong> Control your line &amp; scrub speed',
  'help.mobOllie': '<strong>Pop Airs:</strong> Pop off the lip for airs (hold in mid-air for Indy Grab)',
  'help.mobTrick': '<strong>Surf Moves:</strong> Spins, Grabs &amp; Lip Stalls in air or on coping',
  'help.mobCompress': '<strong>Compression:</strong> Crouch low before transitions for speed, release for airs',
  'help.kbSectionTitle': '⌨️ PC KEYBOARD CONTROLS',
  'help.kbCarveKey': '← / → or A / D',
  'help.kbCarve': '<strong>Carve &amp; Pump:</strong> Carve turns &amp; pump rhythmically for speed',
  'help.kbPushKey': '↑ or W',
  'help.kbPush': '<strong>Push-Off:</strong> Push off from a standstill &amp; build initial speed',
  'help.kbBrakeKey': '↓ or S / Shift',
  'help.kbBrake': '<strong>Compress &amp; Brake:</strong> Crouch into transitions for speed / brake',
  'help.kbOllie': '<strong>Ollie &amp; Grab:</strong> Pop off the coping lip / hold in air for Indy Grab',
  'help.kbTricks': '<strong>Surf Tricks:</strong> Q = Snap, W = Layback, A = Bertslide, S = FS Reverse 360',
  'help.kbCam': '<strong>Camera:</strong> Follow Cam, Filmer Cam, or 3D Orbit Inspect',
  'help.proTip':
    '💡 <strong>PRO TIP:</strong> Pump through the turns and combine COMPRESS + OLLIE at the bowl walls for massive airtime &amp; high scores!',
  'help.tutorialBtn': '🎓 Tutorial',
  'help.okBtn': "GOT IT — LET'S RIDE",

  // First-Run Interactive Tutorial (#tutorial-modal)
  'tutorial.badge': 'SURFSKATE CRASH COURSE',
  'tutorial.modeDesktop': '⌨️ Desktop',
  'tutorial.modeTouch': '📱 Touch',
  'tutorial.skip': 'Skip',
  'tutorial.back': 'Back',
  'tutorial.next': 'Next',
  'tutorial.finish': "Let's Ride!",
  'tutorial.stepCounter': '{step}/{total}',
  'tutorial.ctrlSwitchHint': 'Layout ({mode}) — tap to switch:',

  'tutorial.s1.title': '1. PUSH & CARVE',
  'tutorial.s1.subtitle': 'Get rolling, lean into turns, and control your line.',
  'tutorial.s1.pushTitle': 'Push Off',
  'tutorial.s1.pushDesc': 'Kick-push from a standstill to build initial cruising speed.',
  'tutorial.s1.carveTitle': 'Carve & Steer',
  'tutorial.s1.carveDesc': 'Lean left & right into smooth surf turns along flat ground and bowl walls.',
  'tutorial.s1.brakeTitle': 'Brake & Slow Down',
  'tutorial.s1.brakeDesc': 'Scrub speed before tight pockets or when setting up a lip trick.',
  'tutorial.s1.tip': '💡 <strong>PRO TIP:</strong> Once you are rolling, you do not need to push — pumping keeps you fast!',

  'tutorial.s2.title': '2. PUMPING & SURF-FLOW',
  'tutorial.s2.subtitle': 'Generate speed without touching the ground — pure surfskate physics!',
  'tutorial.s2.flatTitle': 'Flat-Ground Rhythm Pump',
  'tutorial.s2.flatDesc': 'Carve alternating left & right (~1 cycle/sec) to accelerate smoothly on flat concrete.',
  'tutorial.s2.wallTitle': 'Bowl & Wall Compression',
  'tutorial.s2.wallDesc': 'Hold <strong>Compress</strong> while dropping <strong>down</strong> a wall for a speed boost, then release climbing up.',
  'tutorial.s2.flowTitle': '🔥 Surf-Zone Overdrive (80%+ Flow)',
  'tutorial.s2.flowDesc': 'Every rhythmic pump, deep carve & trick fills your Flow Meter. Hit <strong>80%+ Flow</strong> to ignite <strong>Surf-Zone Overdrive (1.5× Points)</strong>!',

  'tutorial.s3.title': '3. SURF-TRICKS: WHAT & WHEN',
  'tutorial.s3.subtitle': '4 signature surfskate moves — each works best in its sweet spot:',
  'tutorial.s3.mobileNote': '📱 On Touch, tap <strong>TRICK</strong> — it automatically fires the move that matches your current speed, carve & wall position!',
  'tutorial.s3.whenLabel': 'WHEN:',
  'tutorial.s3.snapName': 'Snap / Lip Slash',
  'tutorial.s3.snapWhat': 'Whip the tail sharply back down the concrete with spray.',
  'tutorial.s3.snapWhen': 'Near the top/lip of a steep wall at medium-high speed (HUD Snap meter = READY).',
  'tutorial.s3.bertName': 'Bert Slide',
  'tutorial.s3.bertWhat': 'Low hand-plant slide carving the tail out (hold & release).',
  'tutorial.s3.bertWhen': 'Deep carve at solid speed on flat ground, a bank, or bowl wall.',
  'tutorial.s3.laybackName': 'Layback',
  'tutorial.s3.laybackWhat': 'Backside surf carve dragging your trailing hand on the concrete (hold & release).',
  'tutorial.s3.laybackWhen': 'Backside carve (leaning left) at high speed on a transition wall or bank.',
  'tutorial.s3.revName': 'FS Reverse 360',
  'tutorial.s3.revWhat': 'Full 360° frontside tail-spin rotation on the deck.',
  'tutorial.s3.revWhen': 'While carving at high speed anywhere on flat or transition.',

  'tutorial.s4.title': '4. AIR-TRICKS, COMBOS & PARK GOALS',
  'tutorial.s4.subtitle': 'Launch off the coping, chain lines, and stack multipliers!',
  'tutorial.s4.ollieTitle': 'Ollie (Pop Air)',
  'tutorial.s4.ollieDesc': 'Pop off flat ground or launch off a steep bowl lip for big air.',
  'tutorial.s4.indyTitle': 'Indy Grab (Mid-Air)',
  'tutorial.s4.indyDesc': 'Hold while airborne after a wall Ollie to grab the rail for huge style points!',
  'tutorial.s4.comboTitle': 'Line Combos',
  'tutorial.s4.comboDesc': 'Link carves, surf-tricks & airs before the combo timer runs out to multiply your score.',
  'tutorial.s4.goalsTitle': '🔥 Hot-Spots & 🥨 Pretzels',
  'tutorial.s4.goalsDesc': 'Trick inside glowing <strong>Hot-Spot Zones</strong> for <strong>2× Points</strong> (stacks with 1.5× Surf-Zone!) & collect <strong>Pretzels</strong> for bonus points & missions.',

  // Terms & Impressum Modal
  'terms.badge': 'LEGAL, IMPRESSUM & PRIVACY',
  'terms.title': 'SRFSK8 MUNICH — IMPRESSUM, PRIVACY & TERMS',
  'terms.okBtn': 'GOT IT & CLOSE',

  // Flow Line Export Modal
  'flowModal.badge': 'DEV MODE • WAYPOINTS RECORDER',
  'flowModal.title': '🌊 FLOW LINE EXPORT',
  'flowModal.titleCount': '🌊 FLOW LINE EXPORT ({count} PTS)',
  'flowModal.desc':
    'Your custom Flow Line was recorded live in the skatepark! Copy this snippet to chat or directly into <code class="flowline-code">FlowLineChallenge.WAYPOINTS_2D</code>:',
  'flowModal.copyBtn': '📋 COPY WAYPOINTS',
  'flowModal.copiedBtn': 'COPIED TO CLIPBOARD! ✓',
  'flowModal.testBtn': '▶ TEST RECORDED LINE',

  // Session Summary Modal
  'summary.kicker': '2-MINUTE SESSION COMPLETE',
  'summary.newHighScore': '★ NEW HIGH SCORE!',
  'summary.finalScore': 'FINAL SCORE',
  'summary.bestCombo': 'BEST LINE COMBO',
  'summary.pretzels': 'PRETZELS',
  'summary.challengesTitle': 'SURF CHALLENGES',
  'summary.lbTitle': '🏆 GLOBAL HIGHSCORE',
  'summary.riderPlaceholder': 'Rider Name (min. 2 chars)',
  'summary.saveBtn': '🏆 SAVE',
  'summary.retryBtn': '↻ SKATE AGAIN (SPACE)',
  'summary.garageBtn': '🏠 BACK TO GARAGE',
  'summary.missionComplete': 'COMPLETE!',
  'summary.lbEnterName': 'Enter rider name & click SAVE for the leaderboard!',
  'summary.lbNeedScore': 'Score > 0 required for the leaderboard.',
  'summary.lbNameMinError': 'Please enter at least 2 characters (letters/numbers).',
  'summary.lbScoreMinError': 'Score must be greater than 0.',
  'summary.lbSaving': '⏳ Saving score...',
  'summary.lbSaveFailed': 'Save failed.',
  'summary.lbRank': 'Rank #{rank}',
  'summary.lbSaved': 'Saved',
  'summary.lbNewBest': ' • ★ NEW PERSONAL BEST!',
  'summary.lbLocalTag': ' (Local Preview)',
  'summary.lbBestLine': '✅ {rankText} • Best: {bestText}{newBestTag}{sourceTag}',
  'summary.lbEmpty': 'No park scores yet — claim #1!',

  // LeaderboardService errors
  'lbErr.nameMin': 'Rider name must be at least 2 characters long.',
  'lbErr.scoreRange': 'Score must be between 1 and 500,000.',
  'lbErr.invalidInput': 'Invalid input.',

  // In-Game HUD
  'hud.session': 'Session',
  'hud.freeSurf': 'Free Surf',
  'hud.zenTimer': '∞ ZEN SURF',
  'hud.overtime': '🔥 OVERTIME!',
  'hud.keepCombo': 'Keep Combo Alive!',
  'hud.score': 'Score',
  'hud.bestLine': 'Best Line',
  'hud.pretzels': 'Pretzels',
  'hud.pretzelTitle': 'Munich Pretzels (+50 pts each, +500 all)',
  'hud.challenges': 'CHALLENGES',
  'hud.garage': 'Garage',
  'hud.garageTitle': 'Back to Garage / Landing Page [ESC]',
  'hud.flow': 'Flow',
  'hud.surfZone': '🔥 SURF-ZONE 1.5X',
  'hud.lean': 'Lean',
  'hud.perfectPump': 'PERFECT PUMP',
  'hud.hotSpotInside': '🔥 2X HOT SPOT ACTIVE • {spot} ({sec}s)',
  'hud.hotSpotOutside': '🔥 HOT SPOT: {spot} (2X SCORE — {sec}s)',
  'hud.hotSpotToast': '🔥 HOT SPOT: {spot} (2X SCORE — {sec}s)!',
  'hud.missionCompleteToast': '🎯 MISSION COMPLETE: {title}!',
  'hud.rankUpToast': '👑 RANK UP: {rank}!',
  'hud.rankUpBanner': 'RANK UP: {title}!',
  'hud.flowCupBanner': '🌊 FLOW CUP — FOLLOW THE LINE!',
  'hud.autoQualityBanner': 'AUTO QUALITY: {quality}',
  'hud.surfChallengesRank': 'Surf-Challenges • {rank}',

  // HUD Snap / Indy / Coach Hints
  'hud.indyHold': 'INDY GRAB — HOLD SPACE',
  'hud.indyTweak': 'TWEAK THE INDY!',
  'hud.snapReady': 'SNAP READY — press {key}',
  'hud.snapTooSlow': 'Too slow to snap',
  'hud.snapTooFast': 'Too fast to snap',
  'hud.wipeoutPrefix': 'WIPEOUT: {reason}',
  'hud.wipeoutFallback': 'Land aligned with travel direction!',
  'hud.pushTouch': 'Tap ▲ PUMP to push off',
  'hud.pushKey': 'Press {key} once to push off',

  // Physics / Controller Hints & Bail Reasons
  'ctrl.coachAligned': 'Aligned landings: point your board in travel direction!',
  'ctrl.coachPumpNow': 'Now PUMP: alternate ← → in rhythm to gain speed',
  'ctrl.coachPumpCruise': 'At cruise speed — PUMP: alternate ← → in rhythm (≈ 1 left-right cycle per second)',
  'ctrl.coachTooSlowPush': 'Too slow to pump — press ↑ once to push off',
  'ctrl.coachTooHectic': 'Too hectic! Slow down your ← → rhythm',
  'ctrl.coachFasterRhythm': 'Faster rhythm: switch ← → about twice per second',
  'ctrl.bailGrab': 'LET GO OF GRAB BEFORE IMPACT!',
  'ctrl.bailBackwards': 'LANDED BACKWARDS!',
  'ctrl.bailNotAligned': 'NOT ALIGNED WITH TRAVEL!',
  'ctrl.snapTopOfWall': 'SNAP: get to the top of a wall!',
  'ctrl.snapFeedbackSlow': 'TOO SLOW!',
  'ctrl.snapFeedbackFast': 'TOO FAST!',

  // HUD Dock (Tricks, Riding, Options)
  'dock.toggleTitle': 'Show / hide tricks & options [H]',
  'dock.toggleLabel': 'Tricks & Options',
  'dock.tricksTitle': 'Tricks',
  'dock.ridingTitle': 'Riding',
  'dock.optionsTitle': 'Options',
  'dock.trickSnap': 'top of a wall, right speed',
  'dock.trickLayback': 'hold in a fast, deep turn',
  'dock.trickBert': 'hold while leaning into a turn',
  'dock.trickReverse': 'while carving → with speed',
  'dock.trickIndy': 'ollie off a wall, hold in air',
  'dock.mobOllie': 'pop off the lip / airs',
  'dock.mobIndy': 'hold in mid-air',
  'dock.mobTrick': 'air spin & coping snap',
  'dock.mobBert': 'hold while carving a turn',
  'dock.mobLip': 'on the bowl coping',
  'dock.mobCompress': 'crouch before transition',
  'dock.kbPush': 'one push-off from a standstill',
  'dock.kbCarve': 'carve — alternate in rhythm to pump',
  'dock.kbCompress': 'compress on a wall drop = stronger pump',
  'dock.kbOllie': 'ollie',
  'dock.kbCam': 'camera positions & 3D orbit',
  'dock.kbSwitchWasd': 'switch to WASD driving',
  'dock.kbSwitchArrows': 'switch to Arrow Keys driving',
  'dock.kbMusic': 'mute music / <span class="key">N</span> next song',
  'dock.mobRideCarve': 'carve — surf the bowl walls',
  'dock.mobRidePump': 'push off &amp; pump for speed',
  'dock.mobRideBrake': 'brake &amp; control speed',
  'dock.mobRideOllie': 'pop off the lip / airs',
  'dock.mobRideTrick': 'Snap, Bert, Layback &amp; 360',
  'dock.mobRideCompress': 'crouch before transition',
  'dock.ctrlArrows': '🎮 Controls: Arrow Keys [Tab]',
  'dock.ctrlWasd': '🎮 Controls: WASD [Tab]',
  'dock.aspectReel': '📱 9:16 IG Reel Mode [R]',
  'dock.aspectDesktop': '🖥️ 16:9 Desktop [R]',
  'dock.atmosphereNight': '🌙 Floodlit Munich Night',
  'dock.camFollow': '🎥 Follow Cam [1]',
  'dock.camFilmer': '📹 Filmer Cam [2]',
  'dock.camMural': '🌴 Palm Mural Cam [3]',
  'dock.camOrbit': '🔍 3D Orbit Inspect [4 / O]',
  'dock.truckSmooth': '🛹 Truck: Smooth [T]',
  'dock.truckBalanced': '🛹 Truck: Balanced [T]',
  'dock.truckSnappy': '🛹 Truck: Snappy [T]',
  'dock.autoShredOn': '🤖 Auto-Shred: ON [J]',
  'dock.manualControl': '🎮 Manual Control [J]',
  'dock.musicTrack': '🎵 Track {track} [M] [N]',
  'dock.musicOff': '🔇 Music: OFF [M]',
  'dock.qualityAuto': '⚡ Quality: AUTO ({eff}) [U]',
  'dock.qualityHigh': '⚡ Quality: HIGH [U]',
  'dock.qualityMedium': '⚡ Quality: MEDIUM [U]',
  'dock.qualityLow': '⚡ Quality: PERFORMANCE [U]',
  'dock.touchOn': '📱 Touch Controls: ON',
  'dock.touchOff': '📱 Touch Controls: OFF',
  'dock.fullscreen': 'Fullscreen',
  'dock.exitFullscreen': 'Exit Fullscreen',
  'dock.respawn': '↺ Respawn [X]',
  'dock.viewer': '🔍 3D Photogrammetry Viewer',
  'dock.garage': '🏠 Garage Selector [ESC]',
  'dock.recFlowLine': '🔴 Rec Flow Line [L]',

  // Dev Flow Recorder HUD
  'rec.pillActive': '🔴 REC: {pts} PTS — [L] FINISH',
  'rec.pillSaved': '📋 LINE: {pts} PTS — [L] REC NEW',
  'rec.pillIdle': '🔴 REC FLOW LINE [L]',
  'rec.btnStop': '⏹ STOP [L]',
  'rec.btnStart': '🔴 REC LINE [L]',
  'rec.hintRecording': '🔴 REC FLOW LINE: {pts} pts — Press [L] to finish & export',
  'rec.bannerStart': '🔴 REC FLOW LINE — SKATE & PRESS [L] TO FINISH',
  'rec.hintStart': '🔴 RECORDING FLOW LINE (1 pt) — Press [L] to stop',
  'rec.bannerSaved': 'FLOW LINE SAVED: {pts} PTS!',
  'rec.hintSaved': 'FLOW LINE READY — Enter Start Gate to test line',
  'rec.bannerCancelled': 'REC CANCELLED (NEED >= 3 PTS)',
  'rec.bannerTestReady': 'READY TO TEST — RIDE TO START GATE!',
  'rec.hintTestReady': '🌊 ENTER START GATE TO BEGIN CHALLENGE',

  // Flow Line Challenge
  'flow.finishGate': '🏁 FINISH GATE',
  'flow.finishBonus': '+{pts} FLOW BONUS',
  'flow.pbStart': 'PB: {pb}s • SKATE IN TO START',
  'flow.parkChanged': 'PARK CHANGED',
  'flow.lost': 'FLOW LINE LOST!',
  'flow.tooFar': 'FLOW LINE ENDED — TOO FAR!',
  'flow.newRecord': '🏆 NEW RECORD! {time}s (+{pts} PTS)',
  'flow.complete': 'FLOW LINE COMPLETE! {time}s (+{pts} PTS)',

  // Pretzel Collectibles
  'pretzel.allBonus': '🥨 ALL PRETZELS! +500 BONUS!',
  'pretzel.single': '🥨 PRETZEL! +50 ({count}/{total})',

  // Medals
  'medal.bronze': 'BRONZE MEDAL',
  'medal.silver': 'SILVER MEDAL',
  'medal.gold': 'GOLD MEDAL',
  'medal.sick': 'SICK SCORE LEGEND',
  'medal.none': 'SESSION COMPLETE',
  'medal.bronzeShort': 'BRONZE',
  'medal.silverShort': 'SILVER',
  'medal.goldShort': 'GOLD',
  'medal.sickShort': 'SICK SCORE',

  // Near-Miss Hints
  'nearmiss.medalClose':
    '🔥 ALMOST {medalShort}! Only {pts} pts away from {icon} {medalLabel}! Run it back!',
  'nearmiss.missionHalf':
    '⚡ SO CLOSE: Only {rem}{unit} left for your mission "{mission}"!',
  'nearmiss.nextGoal':
    '🎯 NEXT GOAL: {pts} pts to reach {icon} {medalLabel} ({threshold} PTS)!',
  'nearmiss.sickLegend':
    '👑 SICK SCORE LEGEND! You completely owned the park — can you beat your own record?',

  // Missions (Title & ShortTitle)
  'mission.l1_carves_snaps.title': 'Land 3 Carves or Snaps in one session',
  'mission.l1_carves_snaps.short': 'Land 3 Carves / Snaps',
  'mission.l1_pretzels_3.title': 'Collect 3 Pretzels in the park',
  'mission.l1_pretzels_3.short': 'Collect 3 Pretzels',
  'mission.l1_score_2500.title': 'Reach 2,500 PTS session score',
  'mission.l1_score_2500.short': '2,500 PTS Session Score',
  'mission.l2_bert_layback.title': 'Land 2 Bert Slides or Laybacks',
  'mission.l2_bert_layback.short': '2 Bert Slides / Laybacks',
  'mission.l2_combo_1500.title': 'Land a 1,500-point combo',
  'mission.l2_combo_1500.short': '1,500 PTS Combo',
  'mission.l2_surfzone_8s.title': 'Hold >= 80% Flow (Surf-Zone) for 8 seconds',
  'mission.l2_surfzone_8s.short': '8s in Surf-Zone (80%+ Flow)',
  'mission.l3_flow_line.title': "Complete a 'Follow the Flow' line",
  'mission.l3_flow_line.short': "Complete 'Follow the Flow' Line",
  'mission.l3_pretzels_5.title': 'Collect all 5 Pretzels in one session',
  'mission.l3_pretzels_5.short': 'Collect all 5 Pretzels',
  'mission.l3_score_12000.title': 'Reach 12,000 points (Silver Medal)',
  'mission.l3_score_12000.short': '12,000 PTS (Silver Medal)',
  'mission.l4_indy_360.title': 'Land 3 Indy Grabs or 360 Airs',
  'mission.l4_indy_360.short': '3 Indy Grabs / 360 Spins',
  'mission.l4_hotspot_tricks.title': 'Score 2 tricks inside a 🔥 Hot-Spot zone',
  'mission.l4_hotspot_tricks.short': '2 Tricks in 🔥 Hot-Spot',
  'mission.l4_combo_4000.title': 'Land a 4,000-point combo',
  'mission.l4_combo_4000.short': '4,000 PTS Combo',
  'mission.l5_perfect_tricks.title': 'Land 4 different surf tricks in one session',
  'mission.l5_perfect_tricks.short': '4 Different Surf Tricks',
  'mission.l5_surfzone_15s.title': 'Hold >= 80% Flow (Surf-Zone) for 15 seconds',
  'mission.l5_surfzone_15s.short': '15s in Surf-Zone (80%+ Flow)',
  'mission.l5_score_25000.title': 'Reach 25,000 points (Gold Medal)',
  'mission.l5_score_25000.short': '25,000 PTS (Gold Medal)',
  'mission.l6_hotspot_4.title': 'Score 4 tricks inside a 🔥 Hot-Spot zone',
  'mission.l6_hotspot_4.short': '4 Tricks in 🔥 Hot-Spot',
  'mission.l6_combo_8000.title': 'Land an 8,000-point monster combo',
  'mission.l6_combo_8000.short': '8,000 PTS Monster Combo',
  'mission.l6_score_45000.title': 'Reach 45,000 points (💎 Sick Score)',
  'mission.l6_score_45000.short': '45,000 PTS (💎 Sick Score)',
  'mission.l7_flow_lines_2.title': "Complete 2 'Follow the Flow' lines in one session",
  'mission.l7_flow_lines_2.short': "2 'Follow the Flow' Lines",
  'mission.l7_surfzone_22s.title': 'Hold >= 80% Flow (Surf-Zone) for 22 seconds',
  'mission.l7_surfzone_22s.short': '22s in Surf-Zone',
  'mission.l7_snaps_5.title': 'Land 5 Snaps or Bert Slides on the lip',
  'mission.l7_snaps_5.short': '5 Snaps / Bert Slides',
} as const;

export type TranslationKey = keyof typeof EN_TRANSLATIONS;

const DE_TRANSLATIONS: Record<TranslationKey, string> = {
  // App & Loader
  'app.title': 'SRFSK8 — Level 1: Skatepark "Im Wiesengrund"',
  'loader.text': 'Lade SRFSK8 Game',

  // Common
  'common.close': 'SCHLIESSEN',
  'common.done': 'FERTIG',
  'common.save': '🏆 SPEICHERN',

  // Landing Top Utility Nav
  'nav.leaderboard': 'RANGLISTE',
  'nav.leaderboardTitle': 'Globale Top-Scores / Rangliste',
  'nav.soundTitle': 'Sound / Musik umschalten [M]',
  'nav.soundOn': 'SOUND: AN',
  'nav.soundOff': 'SOUND: AUS',
  'nav.qualityTitle': 'Grafikqualität umschalten [Q]',
  'nav.qualityLabel': 'QUALITÄT: {label}',
  'nav.fullscreenTitle': 'Vollbild umschalten',
  'nav.fullscreen': 'VOLLBILD',
  'nav.exitFullscreen': 'VOLLBILD BEENDEN',
  'nav.help': 'STEUERUNG',
  'nav.helpTitle': 'Steuerung & Hilfe',
  'nav.terms': 'IMPRESSUM / DATENSCHUTZ',
  'nav.termsTitle': 'Impressum & Datenschutzerklärung',
  'nav.langTitle': 'Sprache wechseln: Deutsch / English',
  'nav.settings': 'OPTIONEN',
  'nav.settingsTitle': 'Einstellungen & Menü',
  'nav.settingsMenuTitle': 'EINSTELLUNGEN & MENÜ',
  'nav.soundMenuLabel': 'Sound & Musik',
  'nav.qualityMenuLabel': 'Grafikqualität',
  'nav.fullscreenMenuLabel': 'Vollbild',
  'nav.langMenuLabel': 'Sprache',
  'nav.tutorialMenuLabel': 'Tutorial',
  'nav.tutorialTitle': 'Interaktives Tutorial starten',
  'nav.termsMenuLabel': 'Impressum & Datenschutz',
  'nav.stateOn': 'AN',
  'nav.stateOff': 'AUS',

  // Landing Setup & Mode
  'landing.setup': 'SETUP',
  'landing.skater': 'SKATER',
  'landing.skatepark': 'SKATEPARK',
  'landing.board': 'BOARD',
  'landing.moreToCome': 'BALD MEHR!',
  'landing.noticePark':
    'Sag uns auf <a href="https://www.instagram.com/surfskate_munich/" target="_blank" rel="noopener noreferrer">@surfskate_munich</a>, welchen <strong>Skatepark</strong> du als nächstes willst!',
  'landing.noticeBoard':
    'Sag uns auf <a href="https://www.instagram.com/surfskate_munich/" target="_blank" rel="noopener noreferrer">@surfskate_munich</a>, welches <strong>Board</strong> du als nächstes willst!',
  'landing.showPhoto': 'Foto anzeigen',
  'landing.showBoard': 'Board-Icon anzeigen',
  'landing.view3d': '🔍 3D-ANSICHT',
  'landing.view3dTitle': '3D-Park inspizieren',
  'landing.riderLabel': '🏷️ RIDER',
  'landing.riderPlaceholder': 'Rider-Name (Rangliste)',
  'landing.gameMode': 'SPIELMODUS',
  'landing.modeJam': '2-MIN JAM',
  'landing.modeFlowCup': 'FLOW CUP',
  'landing.modeZen': 'FREE SURF',
  'landing.dropIn': 'DROP IN',
  'landing.pressEnter': 'ENTER DRÜCKEN',
  'landing.challenges': 'CHALLENGES',
  'landing.missionsCount': '{done}/{total} FERTIG',

  // Game Mode Descriptions
  'mode.jamDesc': '⏱️ 120s Highscore-Jagd — Carve Hot-Spots, lande Tricks & sammle Brezeln.',
  'mode.flowCupDesc': '🌊 Follow the Flow — Carve durch Gates, halt den Speed & locke Lines.',
  'mode.zenDesc': '🌅 Endlos Free Surf — Kein Timer, kein Stress: cruise den Bowl bei Sunset.',

  // Leaderboard Modal
  'lb.badge': 'GLOBALE TOP 15 HIGHSCORES',
  'lb.title': '🏆 RANGLISTE',
  'lb.sourceGlobal': 'GLOBAL LIVE',
  'lb.sourceLocal': 'LOKALE VORSCHAU',
  'lb.tabAll': '🌍 ALLE PARKS',
  'lb.tabWiesengrund': '🌲 IM WIESENGRUND',
  'lb.tabAirport': '✈️ AIRPORT PARK',
  'lb.loading': '⏳ Lade Rangliste...',
  'lb.empty': '🏄 Noch keine Scores eingetragen — starte eine 2-Min Session und hol dir Platz #1!',
  'lb.youTag': 'DU',
  'lb.footerHint': 'Jeder Rider behält seinen persönlichen Best-Score.',

  // Help & Controls Modal
  'help.badge': 'SPIELANLEITUNG',
  'help.title': 'STEUERUNG & BOWL-GUIDE',
  'help.tabMobile': '📱 Touch-Steuerung',
  'help.tabKeyboard': '⌨️ PC Tastatur',
  'help.mobileSectionTitle': '📱 SMARTPHONE / TOUCH-STEUERUNG',
  'help.mobCarve': '<strong>Einlenken &amp; Bowl-Wände:</strong> In den Bowl-Wänden carven &amp; Schwung aufbauen',
  'help.mobPump': '<strong>Schwung holen:</strong> Pushen aus dem Stand &amp; in der Transition pumpen für Speed',
  'help.mobBrake': '<strong>Abbremsen:</strong> Kontrollieren &amp; Tempo drosseln',
  'help.mobOllie': '<strong>Abspringen:</strong> An der Lippe für Airs abspringen (in der Luft halten für Indy Grab)',
  'help.mobTrick': '<strong>Surf-Manöver:</strong> In der Luft oder am Coping für Spins, Grabs &amp; Stalls',
  'help.mobCompress': '<strong>Kompression:</strong> Tief in die Knie gehen (Speed aufbauen vor Transition / für Airs loslassen)',
  'help.kbSectionTitle': '⌨️ PC TASTATUR-STEUERUNG',
  'help.kbCarveKey': '← / → oder A / D',
  'help.kbCarve': '<strong>Carve &amp; Pump:</strong> In den Kurven carven &amp; rhythmisch pumpen für Speed',
  'help.kbPushKey': '↑ oder W',
  'help.kbPush': '<strong>Push-Off:</strong> Aus dem Stand anrollen &amp; Schwung holen',
  'help.kbBrakeKey': '↓ oder S / Shift',
  'help.kbBrake': '<strong>Compress &amp; Brake:</strong> Kniebeuge für Speed in der Transition / Abbremsen',
  'help.kbOllie': '<strong>Ollie &amp; Grab:</strong> Abspringen an der Coping-Kante / Halten für Indy Grab',
  'help.kbTricks': '<strong>Surf-Tricks:</strong> Q = Snap, W = Layback, A = Bertslide, S = FS Reverse 360',
  'help.kbCam': '<strong>Kamera:</strong> Follow Cam, Filmer-Cam oder 3D-Orbit',
  'help.proTip':
    '💡 <strong>TIPP:</strong> Pumpe in den Kurven und nutze COMPRESS + OLLIE an den Bowl-Wänden für maximale Airtime &amp; Highscores!',
  'help.tutorialBtn': '🎓 Tutorial',
  'help.okBtn': 'VERSTANDEN & LOS',

  // First-Run Interactive Tutorial (#tutorial-modal)
  'tutorial.badge': 'SURFSKATE SCHNELLKURS',
  'tutorial.modeDesktop': '⌨️ Desktop',
  'tutorial.modeTouch': '📱 Touch',
  'tutorial.skip': 'Überspringen',
  'tutorial.back': 'Zurück',
  'tutorial.next': 'Weiter',
  'tutorial.finish': "Let's Ride!",
  'tutorial.stepCounter': '{step}/{total}',
  'tutorial.ctrlSwitchHint': 'Belegung ({mode}) — zum Wechseln tippen:',

  'tutorial.s1.title': '1. PUSH & CARVE (SPEED AUFBAUEN)',
  'tutorial.s1.subtitle': 'Anrollen, geschmeidig in Kurven legen und dein Tempo kontrollieren.',
  'tutorial.s1.pushTitle': 'Push Off (Anrollen)',
  'tutorial.s1.pushDesc': 'Aus dem Stand anstoßen, bis du Grundgeschwindigkeit hast.',
  'tutorial.s1.carveTitle': 'Carve & Lenken',
  'tutorial.s1.carveDesc': 'Links & rechts in enge Surf-Turns lehnen — auf Flat und in den Bowl-Wänden.',
  'tutorial.s1.brakeTitle': 'Bremsen',
  'tutorial.s1.brakeDesc': 'Tempo vor engen Pockets drosseln oder für einen Lip-Trick dosieren.',
  'tutorial.s1.tip': '💡 <strong>PROFI-TIPP:</strong> Sobald du rollst, musst du nicht mehr pushen — Pumpen hält dich schnell!',

  'tutorial.s2.title': '2. PUMPEN & SURF-FLOW',
  'tutorial.s2.subtitle': 'Speed ohne Pushen aufbauen — echtes Surfskate-Feeling!',
  'tutorial.s2.flatTitle': 'Flat-Ground Rhythmus-Pump',
  'tutorial.s2.flatDesc': 'Carve abwechselnd links & rechts (~1 Zyklus/Sek.), um auf flachem Beton zu beschleunigen.',
  'tutorial.s2.wallTitle': 'Bowl & Wall Compression',
  'tutorial.s2.wallDesc': 'Halte <strong>Compress</strong> beim Runterfahren in die Wall für extra Schub und lass beim Hochfahren los.',
  'tutorial.s2.flowTitle': '🔥 Surf-Zone Overdrive (80%+ Flow)',
  'tutorial.s2.flowDesc': 'Jeder Pump, tiefe Carve & Trick lädt dein Flow-Meter. Ab <strong>80%+ Flow</strong> zündet der <strong>Surf-Zone Overdrive (1,5× Punkte)</strong>!',

  'tutorial.s3.title': '3. SURF-TRICKS: WELCHE & WANN?',
  'tutorial.s3.subtitle': '4 typische Surfskate-Tricks — jeder hat seinen perfekten Moment:',
  'tutorial.s3.mobileNote': '📱 Auf Touch einfach <strong>TRICK</strong> drücken — es wird automatisch der Trick ausgelöst, der zu Speed, Carve & Wall passt!',
  'tutorial.s3.whenLabel': 'WANN:',
  'tutorial.s3.snapName': 'Snap / Lip Slash',
  'tutorial.s3.snapWhat': 'Tail knackig mit Spray wieder die Steilwand hinunterpeitschen.',
  'tutorial.s3.snapWhen': 'Oben nahe der Lippe einer steilen Wall bei mittlerem bis hohem Speed (Snap-Anzeige = READY).',
  'tutorial.s3.bertName': 'Bert Slide',
  'tutorial.s3.bertWhat': 'Tiefer Hand-Plant Slide, bei dem das Tail ausschert (halten & loslassen).',
  'tutorial.s3.bertWhen': 'Tiefer Carve mit gutem Tempo auf Flat, Bank oder Bowl-Wall.',
  'tutorial.s3.laybackName': 'Layback',
  'tutorial.s3.laybackWhat': 'Backside-Surf-Carve mit schleifender Hand am Beton (halten & loslassen).',
  'tutorial.s3.laybackWhen': 'Backside-Carve (nach links lehnen) bei hohem Speed in Transition-Wall oder Bank.',
  'tutorial.s3.revName': 'FS Reverse 360',
  'tutorial.s3.revWhat': 'Komplette 360°-Frontside-Drehung über das Tail auf dem Deck.',
  'tutorial.s3.revWhen': 'Beim Carven mit hohem Speed — überall auf Flat oder Transition.',

  'tutorial.s4.title': '4. AIR-TRICKS, COMBOS & PARK-ZIELE',
  'tutorial.s4.subtitle': 'Über das Coping fliegen, Lines verketten & Multiplikatoren stapeln!',
  'tutorial.s4.ollieTitle': 'Ollie (Absprung)',
  'tutorial.s4.ollieDesc': 'Auf Flat abspringen oder an der steilen Bowl-Lippe für fette Airs launchen.',
  'tutorial.s4.indyTitle': 'Indy Grab (In der Luft)',
  'tutorial.s4.indyDesc': 'Nach einem Wall-Ollie in der Luft gedrückt halten, um ans Board zu greifen — massive Style-Punkte!',
  'tutorial.s4.comboTitle': 'Line Combos',
  'tutorial.s4.comboDesc': 'Verkette Carves, Surf-Tricks & Airs, bevor der Combo-Balken abläuft, um deine Punkte zu vervielfachen.',
  'tutorial.s4.goalsTitle': '🔥 Hot-Spots & 🥨 Brezeln',
  'tutorial.s4.goalsDesc': 'Tricke in leuchtenden <strong>Hot-Spot-Zonen</strong> für <strong>2× Punkte</strong> (stapelt mit 1,5× Surf-Zone!) & sammle <strong>Brezeln</strong> für Bonus-Punkte & Missionen.',

  // Terms & Impressum Modal
  'terms.badge': 'RECHTLICHES, IMPRESSUM & DATENSCHUTZ',
  'terms.title': 'SRFSK8 MUNICH — IMPRESSUM, DATENSCHUTZ & NUTZUNG',
  'terms.okBtn': 'VERSTANDEN & SCHLIESSEN',

  // Flow Line Export Modal
  'flowModal.badge': 'DEV-MODUS • WAYPOINTS RECORDER',
  'flowModal.title': '🌊 FLOW LINE EXPORT',
  'flowModal.titleCount': '🌊 FLOW LINE EXPORT ({count} PKT)',
  'flowModal.desc':
    'Deine eigene Flow Line wurde live im Skatepark aufgezeichnet! Kopiere dieses Snippet in den Chat oder direkt in <code class="flowline-code">FlowLineChallenge.WAYPOINTS_2D</code>:',
  'flowModal.copyBtn': '📋 WAYPOINTS KOPIEREN',
  'flowModal.copiedBtn': 'IN ZWISCHENABLAGE KOPIERT! ✓',
  'flowModal.testBtn': '▶ AUFGEZEICHNETE LINE TESTEN',

  // Session Summary Modal
  'summary.kicker': '2-MINUTEN-SESSION BEENDET',
  'summary.newHighScore': '★ NEUER HIGHSCORE!',
  'summary.finalScore': 'ENDSCORE',
  'summary.bestCombo': 'BESTE LINE-COMBO',
  'summary.pretzels': 'BREZELN',
  'summary.challengesTitle': 'SURF-CHALLENGES',
  'summary.lbTitle': '🏆 GLOBALER HIGHSCORE',
  'summary.riderPlaceholder': 'Rider-Name (min. 2 Zeichen)',
  'summary.saveBtn': '🏆 SPEICHERN',
  'summary.retryBtn': '↻ NOCHMAL FAHREN (SPACE)',
  'summary.garageBtn': '🏠 ZURÜCK ZUR GARAGE',
  'summary.missionComplete': 'GESCHAFFT!',
  'summary.lbEnterName': 'Rider-Namen eingeben & SPEICHERN klicken für die Rangliste!',
  'summary.lbNeedScore': 'Score > 0 erforderlich für die Rangliste.',
  'summary.lbNameMinError': 'Bitte mindestens 2 Zeichen eingeben (Buchstaben/Zahlen).',
  'summary.lbScoreMinError': 'Score muss größer als 0 sein.',
  'summary.lbSaving': '⏳ Speichere Score...',
  'summary.lbSaveFailed': 'Speichern fehlgeschlagen.',
  'summary.lbRank': 'Platz #{rank}',
  'summary.lbSaved': 'Gespeichert',
  'summary.lbNewBest': ' • ★ NEUER BESTWERT!',
  'summary.lbLocalTag': ' (Lokale Vorschau)',
  'summary.lbBestLine': '✅ {rankText} • Bestwert: {bestText}{newBestTag}{sourceTag}',
  'summary.lbEmpty': 'Noch keine Park-Einträge — sichere dir Platz #1!',

  // LeaderboardService errors
  'lbErr.nameMin': 'Rider-Name muss mindestens 2 Zeichen lang sein.',
  'lbErr.scoreRange': 'Score muss zwischen 1 und 500.000 liegen.',
  'lbErr.invalidInput': 'Ungültige Eingabe.',

  // In-Game HUD
  'hud.session': 'Session',
  'hud.freeSurf': 'Free Surf',
  'hud.zenTimer': '∞ ZEN SURF',
  'hud.overtime': '🔥 OVERTIME!',
  'hud.keepCombo': 'Combo halten!',
  'hud.score': 'Punkte',
  'hud.bestLine': 'Beste Line',
  'hud.pretzels': 'Brezeln',
  'hud.pretzelTitle': 'Münchner Brezeln (+50 Pkt je, +500 alle)',
  'hud.challenges': 'CHALLENGES',
  'hud.garage': 'Garage',
  'hud.garageTitle': 'Zurück zur Garage / Startseite [ESC]',
  'hud.flow': 'Flow',
  'hud.surfZone': '🔥 SURF-ZONE 1.5X',
  'hud.lean': 'Neigung',
  'hud.perfectPump': 'PERFECT PUMP',
  'hud.hotSpotInside': '🔥 2X HOT-SPOT AKTIV • {spot} ({sec}s)',
  'hud.hotSpotOutside': '🔥 HOT-SPOT: {spot} (2X PUNKTE — {sec}s)',
  'hud.hotSpotToast': '🔥 HOT-SPOT: {spot} (2X PUNKTE — {sec}s)!',
  'hud.missionCompleteToast': '🎯 MISSION ERFÜLLT: {title}!',
  'hud.rankUpToast': '👑 RANG-AUFSTIEG: {rank}!',
  'hud.rankUpBanner': 'RANG-AUFSTIEG: {title}!',
  'hud.flowCupBanner': '🌊 FLOW CUP — FOLGE DER LINE!',
  'hud.autoQualityBanner': 'AUTO-QUALITÄT: {quality}',
  'hud.surfChallengesRank': 'Surf-Challenges • {rank}',

  // HUD Snap / Indy / Coach Hints
  'hud.indyHold': 'INDY GRAB — SPACE HALTEN',
  'hud.indyTweak': 'INDY HALTEN!',
  'hud.snapReady': 'SNAP BEREIT — {key} drücken',
  'hud.snapTooSlow': 'Zu langsam für Snap',
  'hud.snapTooFast': 'Zu schnell für Snap',
  'hud.wipeoutPrefix': 'WIPEOUT: {reason}',
  'hud.wipeoutFallback': 'Lande gerade in Fahrtrichtung!',
  'hud.pushTouch': 'Tippe ▲ PUMP zum Losfahren',
  'hud.pushKey': 'Drücke {key} einmal zum Losfahren',

  // Physics / Controller Hints & Bail Reasons
  'ctrl.coachAligned': 'Sauber landen: Board in Fahrtrichtung ausrichten!',
  'ctrl.coachPumpNow': 'Jetzt PUMPEN: abwechselnd ← → im Rhythmus für Speed',
  'ctrl.coachPumpCruise': 'Top Speed — PUMP: abwechselnd ← → im Rhythmus (≈ 1x pro Sekunde)',
  'ctrl.coachTooSlowPush': 'Zu langsam zum Pumpen — drücke ↑ einmal zum Pushen',
  'ctrl.coachTooHectic': 'Zu hektisch! Verlangsame deinen ← → Rhythmus',
  'ctrl.coachFasterRhythm': 'Schnellerer Rhythmus: ← → ca. zweimal pro Sekunde wechseln',
  'ctrl.bailGrab': 'GRAB VOR DER LANDUNG LOSLASSEN!',
  'ctrl.bailBackwards': 'RÜCKWÄRTS GELANDET!',
  'ctrl.bailNotAligned': 'NICHT IN FAHRTRICHTUNG GELANDET!',
  'ctrl.snapTopOfWall': 'SNAP: Fahr hoch bis an die Wall-Lippe!',
  'ctrl.snapFeedbackSlow': 'ZU LANGSAM!',
  'ctrl.snapFeedbackFast': 'ZU SCHNELL!',

  // HUD Dock (Tricks, Riding, Options)
  'dock.toggleTitle': 'Tricks & Optionen ein-/ausblenden [H]',
  'dock.toggleLabel': 'Tricks & Optionen',
  'dock.tricksTitle': 'Tricks',
  'dock.ridingTitle': 'Fahren',
  'dock.optionsTitle': 'Optionen',
  'dock.trickSnap': 'oben an der Wall, richtiges Tempo',
  'dock.trickLayback': 'im schnellen, tiefen Turn halten',
  'dock.trickBert': 'beim Einlenken in den Turn halten',
  'dock.trickReverse': 'beim Carven → mit Speed',
  'dock.trickIndy': 'Ollie an der Wall, in der Luft halten',
  'dock.mobOllie': 'abspringen an Lippe / Airs',
  'dock.mobIndy': 'in der Luft halten',
  'dock.mobTrick': 'Air Spin & Coping Snap',
  'dock.mobBert': 'in der Kurve halten',
  'dock.mobLip': 'an der Bowl-Kante',
  'dock.mobCompress': 'Kniebeuge vor Transition',
  'dock.kbPush': 'einmal pushen aus dem Stand',
  'dock.kbCarve': 'carven — im Rhythmus wechseln zum Pumpen',
  'dock.kbCompress': 'in der Wall-Abfahrt ducken = stärkerer Pump',
  'dock.kbOllie': 'Ollie',
  'dock.kbCam': 'Kamerapositionen & 3D-Orbit',
  'dock.kbSwitchWasd': 'auf WASD-Steuerung wechseln',
  'dock.kbSwitchArrows': 'auf Pfeiltasten wechseln',
  'dock.kbMusic': 'Musik stumm / <span class="key">N</span> nächster Song',
  'dock.mobRideCarve': 'carven — in den Bowl-Wänden carven',
  'dock.mobRidePump': 'Schwung holen &amp; pushen',
  'dock.mobRideBrake': 'abbremsen &amp; kontrollieren',
  'dock.mobRideOllie': 'abspringen an der Lippe / Airs',
  'dock.mobRideTrick': 'Snap, Bert, Layback &amp; 360',
  'dock.mobRideCompress': 'Kniebeuge vor Transition',
  'dock.ctrlArrows': '🎮 Steuerung: Pfeiltasten [Tab]',
  'dock.ctrlWasd': '🎮 Steuerung: WASD [Tab]',
  'dock.aspectReel': '📱 9:16 IG Reel-Modus [R]',
  'dock.aspectDesktop': '🖥️ 16:9 Desktop [R]',
  'dock.atmosphereNight': '🌙 Flutlicht München Nacht',
  'dock.camFollow': '🎥 Follow-Cam [1]',
  'dock.camFilmer': '📹 Filmer-Cam [2]',
  'dock.camMural': '🌴 Palmen-Mural-Cam [3]',
  'dock.camOrbit': '🔍 3D-Orbit-Ansicht [4 / O]',
  'dock.truckSmooth': '🛹 Truck: Smooth [T]',
  'dock.truckBalanced': '🛹 Truck: Balanced [T]',
  'dock.truckSnappy': '🛹 Truck: Snappy [T]',
  'dock.autoShredOn': '🤖 Auto-Shred: AN [J]',
  'dock.manualControl': '🎮 Manuelle Steuerung [J]',
  'dock.musicTrack': '🎵 Track {track} [M] [N]',
  'dock.musicOff': '🔇 Musik: AUS [M]',
  'dock.qualityAuto': '⚡ Qualität: AUTO ({eff}) [U]',
  'dock.qualityHigh': '⚡ Qualität: HOCH [U]',
  'dock.qualityMedium': '⚡ Qualität: MITTEL [U]',
  'dock.qualityLow': '⚡ Qualität: PERFORMANCE [U]',
  'dock.touchOn': '📱 Touch-Steuerung: AN',
  'dock.touchOff': '📱 Touch-Steuerung: AUS',
  'dock.fullscreen': 'Vollbild',
  'dock.exitFullscreen': 'Vollbild beenden',
  'dock.respawn': '↺ Neustart [X]',
  'dock.viewer': '🔍 3D-Photogrammetrie-Viewer',
  'dock.garage': '🏠 Zurück zur Garage [ESC]',
  'dock.recFlowLine': '🔴 Flow Line aufnehmen [L]',

  // Dev Flow Recorder HUD
  'rec.pillActive': '🔴 AUFN: {pts} PKT — [L] FERTIG',
  'rec.pillSaved': '📋 LINE: {pts} PKT — [L] NEU AUFN.',
  'rec.pillIdle': '🔴 FLOW LINE AUFN. [L]',
  'rec.btnStop': '⏹ STOPP [L]',
  'rec.btnStart': '🔴 LINE AUFN. [L]',
  'rec.hintRecording': '🔴 FLOW LINE AUFNAHME: {pts} Pkt — [L] drücken zum Beenden',
  'rec.bannerStart': '🔴 FLOW LINE AUFNAHME — SKATE & DRÜCKE [L] ZUM BEENDEN',
  'rec.hintStart': '🔴 AUFNAHME LÄUFT (1 Pkt) — [L] drücken zum Stoppen',
  'rec.bannerSaved': 'FLOW LINE GESPEICHERT: {pts} PKT!',
  'rec.hintSaved': 'FLOW LINE BEREIT — Fahr ins Start-Gate zum Testen',
  'rec.bannerCancelled': 'AUFNAHME ABGEBROCHEN (MIN. 3 PKT)',
  'rec.bannerTestReady': 'BEREIT ZUM TEST — FAHR ZUM START-GATE!',
  'rec.hintTestReady': '🌊 INS START-GATE FAHREN ZUM STARTEN',

  // Flow Line Challenge
  'flow.finishGate': '🏁 ZIEL-GATE',
  'flow.finishBonus': '+{pts} FLOW BONUS',
  'flow.pbStart': 'PB: {pb}s • REINFAREN ZUM START',
  'flow.parkChanged': 'PARK GEWECHSELT',
  'flow.lost': 'FLOW LINE VERLOREN!',
  'flow.tooFar': 'FLOW LINE BEENDET — ZU WEIT WEG!',
  'flow.newRecord': '🏆 NEUER REKORD! {time}s (+{pts} PTS)',
  'flow.complete': 'FLOW LINE GESCHAFFT! {time}s (+{pts} PTS)',

  // Pretzel Collectibles
  'pretzel.allBonus': '🥨 ALLE BREZELN! +500 BONUS!',
  'pretzel.single': '🥨 BREZEL! +50 ({count}/{total})',

  // Medals
  'medal.bronze': 'BRONZE MEDAILLE',
  'medal.silver': 'SILBER MEDAILLE',
  'medal.gold': 'GOLD MEDAILLE',
  'medal.sick': 'SICK SCORE LEGEND',
  'medal.none': 'SESSION BEENDET',
  'medal.bronzeShort': 'BRONZE',
  'medal.silverShort': 'SILBER',
  'medal.goldShort': 'GOLD',
  'medal.sickShort': 'SICK SCORE',

  // Near-Miss Hints
  'nearmiss.medalClose':
    "🔥 FAST {medalShort}! Nur noch {pts} Punkte bis {icon} {medalLabel}! Versuch's direkt nochmal!",
  'nearmiss.missionHalf':
    '⚡ FAST GESCHAFFT: Noch {rem}{unit} für deine Mission „{mission}“!',
  'nearmiss.nextGoal':
    '🎯 NÄCHSTES ZIEL: Noch {pts} Punkte bis {icon} {medalLabel} ({threshold} PTS)!',
  'nearmiss.sickLegend':
    '👑 SICK SCORE LEGEND! Du hast den Park komplett dominiert — knackst du deinen eigenen Rekord?',

  // Missions (Title & ShortTitle)
  'mission.l1_carves_snaps.title': 'Lande 3 Carves oder Snaps in einer Session',
  'mission.l1_carves_snaps.short': '3 Carves / Snaps landen',
  'mission.l1_pretzels_3.title': 'Sammle 3 Brezeln im Park',
  'mission.l1_pretzels_3.short': '3 Brezeln sammeln',
  'mission.l1_score_2500.title': 'Erreiche 2.500 Punkte Session-Score',
  'mission.l1_score_2500.short': '2.500 PTS Session-Score',
  'mission.l2_bert_layback.title': 'Lande 2 Bert Slides oder Laybacks',
  'mission.l2_bert_layback.short': '2 Bert Slides / Laybacks',
  'mission.l2_combo_1500.title': 'Erreiche eine 1.500-Punkte-Combo',
  'mission.l2_combo_1500.short': '1.500 PTS Combo stehen',
  'mission.l2_surfzone_8s.title': 'Halte 8 Sekunden lang >= 80% Flow (Surf-Zone)',
  'mission.l2_surfzone_8s.short': '8s in der Surf-Zone (80%+ Flow)',
  'mission.l3_flow_line.title': "Schaffe eine 'Follow the Flow'-Line",
  'mission.l3_flow_line.short': "'Follow the Flow'-Line schaffen",
  'mission.l3_pretzels_5.title': 'Sammle alle 5 Brezeln in einer Session',
  'mission.l3_pretzels_5.short': 'Alle 5 Brezeln sammeln',
  'mission.l3_score_12000.title': 'Erreiche 12.000 Punkte (Silber-Medaille)',
  'mission.l3_score_12000.short': '12.000 PTS (Silber-Medaille)',
  'mission.l4_indy_360.title': 'Lande 3 Indy Grabs oder 360 Airs',
  'mission.l4_indy_360.short': '3 Indy Grabs / 360 Spins',
  'mission.l4_hotspot_tricks.title': 'Scorte 2 Tricks in einer 🔥 Hot-Spot-Zone',
  'mission.l4_hotspot_tricks.short': '2 Tricks im 🔥 Hot-Spot',
  'mission.l4_combo_4000.title': 'Erreiche eine 4.000-Punkte-Combo',
  'mission.l4_combo_4000.short': '4.000 PTS Combo stehen',
  'mission.l5_perfect_tricks.title': 'Lande 4 verschiedene Surf-Tricks in einer Session',
  'mission.l5_perfect_tricks.short': '4 verschiedene Surf-Tricks',
  'mission.l5_surfzone_15s.title': 'Halte 15 Sekunden lang >= 80% Flow (Surf-Zone)',
  'mission.l5_surfzone_15s.short': '15s in der Surf-Zone (80%+ Flow)',
  'mission.l5_score_25000.title': 'Erreiche 25.000 Punkte (Gold-Medaille)',
  'mission.l5_score_25000.short': '25.000 PTS (Gold-Medaille)',
  'mission.l6_hotspot_4.title': 'Scorte 4 Tricks in einer 🔥 Hot-Spot-Zone',
  'mission.l6_hotspot_4.short': '4 Tricks im 🔥 Hot-Spot',
  'mission.l6_combo_8000.title': 'Erreiche eine 8.000-Punkte-Monster-Combo',
  'mission.l6_combo_8000.short': '8.000 PTS Monster-Combo',
  'mission.l6_score_45000.title': 'Erreiche 45.000 Punkte (💎 Sick Score)',
  'mission.l6_score_45000.short': '45.000 PTS (💎 Sick Score)',
  'mission.l7_flow_lines_2.title': "Schaffe 2 'Follow the Flow'-Lines in einer Session",
  'mission.l7_flow_lines_2.short': "2 'Follow the Flow'-Lines",
  'mission.l7_surfzone_22s.title': 'Halte 22 Sekunden lang >= 80% Flow (Surf-Zone)',
  'mission.l7_surfzone_22s.short': '22s in der Surf-Zone',
  'mission.l7_snaps_5.title': 'Lande 5 Snaps oder Bert Slides an der Lip',
  'mission.l7_snaps_5.short': '5 Snaps / Bert Slides',
};

const TRANSLATIONS: Record<Language, Record<TranslationKey, string>> = {
  en: EN_TRANSLATIONS,
  de: DE_TRANSLATIONS,
};

function detectInitialLang(): Language {
  // 1. URL query param ?lang=de or ?lang=en
  try {
    if (typeof window !== 'undefined' && window.location) {
      const param = new URLSearchParams(window.location.search).get('lang')?.toLowerCase();
      if (param === 'de' || param === 'en') {
        return param;
      }
    }
  } catch {
    // ignore URL errors
  }

  // 2. Persisted user preference in localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)?.toLowerCase();
      if (saved === 'de' || saved === 'en') {
        return saved;
      }
    }
  } catch {
    // ignore storage errors
  }

  // 3. Browser language detection
  try {
    if (typeof navigator !== 'undefined') {
      const browserLang = (navigator.languages?.[0] || navigator.language || '').toLowerCase();
      if (browserLang.startsWith('de')) {
        return 'de';
      }
    }
  } catch {
    // ignore navigator errors
  }

  return 'en';
}

let currentLang: Language = detectInitialLang();
const listeners = new Set<(lang: Language) => void>();

if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.lang = currentLang;
}

export function getLang(): Language {
  return currentLang;
}

export function setLang(lang: Language): void {
  const changed = currentLang !== lang;
  currentLang = lang;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
  } catch {
    // ignore storage errors
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lang;
  }
  if (typeof document !== 'undefined') {
    applyDomTranslations(document);
  }
  if (changed) {
    for (const cb of listeners) {
      try {
        cb(lang);
      } catch (err) {
        console.error('i18n listener error:', err);
      }
    }
  }
}

export function toggleLang(): Language {
  const next: Language = currentLang === 'de' ? 'en' : 'de';
  setLang(next);
  return next;
}

export function onLangChange(cb: (lang: Language) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function formatNum(n: number): string {
  return n.toLocaleString(currentLang === 'de' ? 'de-DE' : 'en-US');
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  let str = dict[key] ?? TRANSLATIONS.en[key] ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  return str;
}

export function applyDomTranslations(root: ParentNode = document): void {
  if (typeof document === 'undefined' || !root) return;

  if (root === document) {
    document.documentElement.lang = currentLang;
    document.title = t('app.title');
  }

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n') as TranslationKey | null;
    if (key) el.textContent = t(key);
  });

  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html') as TranslationKey | null;
    if (key) el.innerHTML = t(key);
  });

  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder') as TranslationKey | null;
    if (key) el.setAttribute('placeholder', t(key));
  });

  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title') as TranslationKey | null;
    if (key) el.setAttribute('title', t(key));
  });

  root.querySelectorAll<HTMLElement>('[data-lang-only]').forEach((el) => {
    const targetLang = el.getAttribute('data-lang-only');
    el.classList.toggle('hidden', targetLang !== currentLang);
  });
}
