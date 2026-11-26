// =============================================================================
// routes/auth.routes.js
// =============================================================================
const router = require('express').Router();
const authCtrl = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateRegister, validateLogin, validateRefresh, validateUpdateProfile } = require('../middleware/validation.middleware');

router.post('/register', validateRegister, authCtrl.register);
router.post('/login',    validateLogin, authCtrl.login);
router.post('/refresh',  validateRefresh, authCtrl.refresh);
router.post('/logout',   authCtrl.logout);
router.get ('/me',              authenticate, authCtrl.me);
router.put ('/profile',         authenticate, validateUpdateProfile, authCtrl.updateProfile);
router.get ('/sessions',        authenticate, authCtrl.getSessions);
router.post('/revoke-sessions', authenticate, authCtrl.revokeSessions);

module.exports = router;
