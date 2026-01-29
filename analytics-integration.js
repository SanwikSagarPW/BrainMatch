/**
 * Analytics Integration for BrainMatch Game
 * 
 * This module integrates the AnalyticsManager bridge with the existing game
 * without modifying the original script.js file. It uses monkey-patching to
 * hook into game functions and track analytics events.
 */

// ============================================================================
// INITIALIZATION
// ============================================================================

// Generate unique session ID
const sessionID = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Initialize Analytics Manager (from analytics-bridge.js)
const analytics = new AnalyticsManager();
analytics.initialize('BrainMatch', sessionID);

console.log('[Analytics] Initialized with Session ID:', sessionID);

// ============================================================================
// ANALYTICS HELPER FUNCTIONS
// ============================================================================

// Track level start time for duration calculation
let levelStartTime = null;
let currentLevelId = null;

// Replicate XP calculation from script.js
function calculateXP(level, turns) {
  switch (level) {
    case 1:
      if (turns <= 12) return 40;
      if (turns <= 16) return 35;
      return 30;
    case 2:
      if (turns <= 14) return 60;
      if (turns <= 18) return 50;
      return 40;
    case 3:
      if (turns <= 16) return 100;
      if (turns <= 20) return 80;
      return 60;
    default:
      return 0;
  }
}

// ============================================================================
// MONKEY-PATCHING: LEVEL START
// ============================================================================

// Hook into Campaign Mode - startGame()
const originalStartGame = window.startGame;
window.startGame = function(level) {
  // Track level start
  currentLevelId = `campaign_level_${level}`;
  levelStartTime = Date.now();
  
  analytics.startLevel(currentLevelId);
  console.log(`[Analytics] Started Level: ${currentLevelId}`);
  
  // Call original function
  originalStartGame.apply(this, arguments);
};

// Hook into Reflex Mode - startReflexMode()
const originalStartReflexMode = window.startReflexMode;
window.startReflexMode = function() {
  // Track reflex mode start
  currentLevelId = 'reflex_mode';
  levelStartTime = Date.now();
  
  analytics.startLevel(currentLevelId);
  console.log(`[Analytics] Started Level: ${currentLevelId}`);
  
  // Call original function
  originalStartReflexMode.apply(this, arguments);
};

// ============================================================================
// MONKEY-PATCHING: LEVEL END (Success Cases)
// ============================================================================

// Hook into Campaign Win - handleCampaignWin()
const originalHandleCampaignWin = window.handleCampaignWin;
window.handleCampaignWin = function() {
  try {
    // Capture data BEFORE calling original function
    const gameState = window.gameState || {};
    const level = gameState.currentCampaignLevel || 1;
    const turns = gameState.turns || 0;
    const xp = calculateXP(level, turns);
    const timeTaken = levelStartTime ? Date.now() - levelStartTime : 0;
    
    // Track level completion
    analytics.endLevel(currentLevelId, true, timeTaken, xp);
    
    // Add raw metrics
    analytics.addRawMetric('level', level.toString());
    analytics.addRawMetric('turns', turns.toString());
    analytics.addRawMetric('xp_earned', xp.toString());
    
    console.log(`[Analytics] Completed Level: ${currentLevelId}, Success: true, Time: ${timeTaken}ms, XP: ${xp}`);
    
    // Submit report
    analytics.submitReport();
    console.log('[Analytics] Report submitted');
  } catch (error) {
    console.error('[Analytics] Error in handleCampaignWin:', error);
  }
  
  // Always call original function
  return originalHandleCampaignWin.call(this);
};

// Hook into Reflex Mode End - handleReflexModeEnd()
const originalHandleReflexModeEnd = window.handleReflexModeEnd;
window.handleReflexModeEnd = function() {
  try {
    const gameState = window.gameState || {};
    const moves = gameState.turns || 0;
    const timeTaken = levelStartTime ? Date.now() - levelStartTime : 0;
    
    // Track reflex mode completion (no XP in reflex mode)
    analytics.endLevel(currentLevelId, true, timeTaken, 0);
    
    // Add raw metrics
    analytics.addRawMetric('total_moves', moves.toString());
    
    console.log(`[Analytics] Completed Reflex Mode, Success: true, Time: ${timeTaken}ms, Moves: ${moves}`);
    
    // Submit report
    analytics.submitReport();
    console.log('[Analytics] Report submitted');
  } catch (error) {
    console.error('[Analytics] Error in handleReflexModeEnd:', error);
  }
  
  // Always call original function
  return originalHandleReflexModeEnd.call(this);
};

// ============================================================================
// MONKEY-PATCHING: LEVEL END (Failure Cases)
// ============================================================================

// Hook into Timer Failure - startTimer()
// We need to intercept the failure condition inside the timer
const originalStartTimer = window.startTimer;
window.startTimer = function(duration) {
  // Call original function first
  originalStartTimer.apply(this, arguments);
  
  // Replace the interval with our wrapped version
  clearInterval(window.gameState.timerId);
  
  window.gameState.timerId = setInterval(() => {
    if (window.gameState.isPaused) return;
    
    window.gameState.timeRemaining--;
    window.timerDisplay.textContent = window.gameState.timeRemaining;
    
    if (window.gameState.timeRemaining <= 0) {
      window.clearAllTimers();
      
      // Track level failure
      const timeTaken = levelStartTime ? Date.now() - levelStartTime : 0;
      const turns = window.gameState.turns;
      
      analytics.endLevel(currentLevelId, false, timeTaken, 0);
      analytics.addRawMetric('failure_reason', 'timeout');
      analytics.addRawMetric('turns_before_failure', turns.toString());
      
      console.log(`[Analytics] Level Failed: ${currentLevelId}, Reason: timeout, Time: ${timeTaken}ms`);
      
      // Submit report
      analytics.submitReport();
      console.log('[Analytics] Report submitted');
      
      // Original failure handling
      alert("Time's Up! Try again.");
      window.showStartScreen();
    }
  }, 1000);
};

// ============================================================================
// MONKEY-PATCHING: TASK RECORDING
// ============================================================================

// Hook into Correct Match - handleCorrectMatch()
const originalHandleCorrectMatch = window.handleCorrectMatch;
window.handleCorrectMatch = function() {
  // Wrap analytics in try-catch to prevent breaking game flow
  try {
    // IMPORTANT: Capture flipped cards BEFORE calling original function
    // because the original function may clear the flippedCards array
    const flippedCards = window.gameState && window.gameState.flippedCards;
    
    if (flippedCards && flippedCards.length >= 2) {
      const [first, second] = flippedCards;
      const card1Value = first.dataset.value;
      const card2Value = second.dataset.value;
      
      // Get the display value (extract filename if it's an image path)
      const getDisplayValue = (val) => {
        if (val.includes('/') || val.includes('\\')) {
          // Extract filename from path
          return val.split('/').pop().split('\\').pop();
        }
        return val;
      };
      
      const question = `Match: ${getDisplayValue(card1Value)}`;
      const correctAnswer = getDisplayValue(card2Value);
      const userAnswer = getDisplayValue(card2Value);
      
      // Record task (we don't have exact timing per card, so use 0)
      // XP is awarded at level end, not per task
      analytics.recordTask(
        currentLevelId,
        `task_${window.gameState.turns}`,
        question,
        correctAnswer,
        userAnswer,
        0,
        0
      );
      
      console.log(`[Analytics] Task Recorded - Correct Match: ${question} -> ${correctAnswer}`);
    }
  } catch (error) {
    console.error('[Analytics] Error tracking correct match:', error);
  }
  
  // Always call original function regardless of analytics errors
  return originalHandleCorrectMatch.call(this);
};

// Hook into Incorrect Match - handleIncorrectMatch()
const originalHandleIncorrectMatch = window.handleIncorrectMatch;
window.handleIncorrectMatch = function() {
  // Wrap analytics in try-catch to prevent breaking game flow
  try {
    // IMPORTANT: Capture flipped cards BEFORE calling original function
    const flippedCards = window.gameState && window.gameState.flippedCards;
    
    if (flippedCards && flippedCards.length >= 2) {
      const [first, second] = flippedCards;
      const card1Value = first.dataset.value;
      const card2Value = second.dataset.value;
      
      // Get the display value
      const getDisplayValue = (val) => {
        if (val.includes('/') || val.includes('\\')) {
          return val.split('/').pop().split('\\').pop();
        }
        return val;
      };
      
      const question = `Match: ${getDisplayValue(card1Value)}`;
      const correctAnswer = getDisplayValue(first.dataset.match);
      const userAnswer = getDisplayValue(card2Value);
      
      // Record failed task
      analytics.recordTask(
        currentLevelId,
        `task_${window.gameState.turns}`,
        question,
        correctAnswer,
        userAnswer,
        0,
        0
      );
      
      console.log(`[Analytics] Task Recorded - Incorrect Match: ${question}, Expected: ${correctAnswer}, Got: ${userAnswer}`);
    }
  } catch (error) {
    console.error('[Analytics] Error tracking incorrect match:', error);
  }
  
  // Always call original function regardless of analytics errors
  return originalHandleIncorrectMatch.call(this);
};

// Hook into Reflex Timeout - handleReflexTimeout()
const originalHandleReflexTimeout = window.handleReflexTimeout;
window.handleReflexTimeout = function() {
  try {
    const gameState = window.gameState || {};
    if (!gameState.isReflexActive) {
      return originalHandleReflexTimeout.call(this);
    }
    
    const reflexCard = gameState.reflexCard;
    const cardValue = reflexCard ? reflexCard.dataset.value : 'unknown';
    
    const getDisplayValue = (val) => {
      if (val && (val.includes('/') || val.includes('\\'))) {
        return val.split('/').pop().split('\\').pop();
      }
      return val || 'unknown';
    };
    
    const question = `Reflex: ${getDisplayValue(cardValue)}`;
    const correctAnswer = reflexCard ? getDisplayValue(reflexCard.dataset.match) : 'unknown';
    
    // Record timeout as failed task
    analytics.recordTask(
      currentLevelId,
      `task_${gameState.turns || 0}_timeout`,
      question,
      correctAnswer,
      'TIMEOUT',
      0,
      0
    );
    
    console.log(`[Analytics] Task Recorded - Reflex Timeout: ${question}`);
  } catch (error) {
    console.error('[Analytics] Error in handleReflexTimeout:', error);
  }
  
  // Always call original function
  return originalHandleReflexTimeout.call(this);
};

// ============================================================================
// ADDITIONAL RAW METRICS
// ============================================================================

// Track when user returns to main menu (optional)
const originalShowStartScreen = window.showStartScreen;
window.showStartScreen = function() {
  console.log('[Analytics] Returned to main menu');
  
  // Call original function
  originalShowStartScreen.apply(this, arguments);
};

console.log('[Analytics] Integration script loaded successfully');
