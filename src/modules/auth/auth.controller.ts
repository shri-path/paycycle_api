import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendCreated } from '@/common/api-wrapper/response.util';
import { SignupService } from './commands/signup/signup.service';
import { LoginService } from './commands/login/login.service';
import { RefreshTokenService } from './commands/refresh-token/refresh-token.service';
import { ForgotPasswordService } from './commands/forgot-password/forgot-password.service';
import { ResetPasswordService } from './commands/reset-password/reset-password.service';
import { LogoutService } from './commands/logout/logout.service';

export class AuthController {
  constructor(
    private readonly signupService: SignupService,
    private readonly loginService: LoginService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly forgotPasswordService: ForgotPasswordService,
    private readonly resetPasswordService: ResetPasswordService,
    private readonly logoutService: LogoutService
  ) {}

  /**
   * @openapi
   * /auth/signup:
   *   post:
   *     tags: [Authentication]
   *     summary: Register a new vendor account
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [phone, password, vendorName]
   *             properties:
   *               phone:
   *                 type: string
   *                 example: "+919876543210"
   *               password:
   *                 type: string
   *                 example: "Test@123x"
   *               vendorName:
   *                 type: string
   *                 example: "Ramesh Dairy"
   *     responses:
   *       201:
   *         description: Signup successful
   *       400:
   *         description: Validation error
   *       409:
   *         description: Phone already registered
   *       429:
   *         description: Too many requests
   */
  signup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as { phone: string; password: string; vendorName: string };
      const result = await this.signupService.execute({
        phone: body.phone,
        password: body.password,
        vendorName: body.vendorName,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendCreated(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     tags: [Authentication]
   *     summary: Login with phone and password
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [phone, password]
   *             properties:
   *               phone:
   *                 type: string
   *                 example: "+919876543210"
   *               password:
   *                 type: string
   *                 example: "Test@123x"
   *     responses:
   *       200:
   *         description: Login successful
   *       400:
   *         description: Validation error
   *       401:
   *         description: Invalid credentials
   *       429:
   *         description: Too many requests
   */
  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as { phone: string; password: string; deviceId?: string };
      const result = await this.loginService.execute({
        phone: body.phone,
        password: body.password,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        deviceId: body.deviceId ?? null,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /auth/refresh:
   *   post:
   *     tags: [Authentication]
   *     summary: Refresh access token
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [refreshToken]
   *             properties:
   *               refreshToken:
   *                 type: string
   *     responses:
   *       200:
   *         description: Tokens refreshed
   *       400:
   *         description: Missing refreshToken
   *       401:
   *         description: Invalid or expired refresh token
   */
  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as { refreshToken: string };
      const result = await this.refreshTokenService.execute({
        refreshToken: body.refreshToken,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /auth/forgot-password:
   *   post:
   *     tags: [Authentication]
   *     summary: Request OTP for password reset
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [phone]
   *             properties:
   *               phone:
   *                 type: string
   *                 example: "+919876543210"
   *     responses:
   *       200:
   *         description: OTP sent (always same response for security)
   *       400:
   *         description: Validation error
   *       429:
   *         description: Too many requests
   */
  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as { phone: string };
      const result = await this.forgotPasswordService.execute({
        phone: body.phone,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /auth/reset-password:
   *   post:
   *     tags: [Authentication]
   *     summary: Reset password using OTP
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [phone, resetToken, otpCode, newPassword]
   *             properties:
   *               phone:
   *                 type: string
   *               resetToken:
   *                 type: string
   *               otpCode:
   *                 type: string
   *                 example: "123456"
   *               newPassword:
   *                 type: string
   *     responses:
   *       200:
   *         description: Password updated
   *       400:
   *         description: Invalid OTP or validation error
   */
  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as {
        phone: string;
        resetToken: string;
        otpCode: string;
        newPassword: string;
      };
      const result = await this.resetPasswordService.execute({
        phone: body.phone,
        resetToken: body.resetToken,
        otpCode: body.otpCode,
        newPassword: body.newPassword,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /auth/logout:
   *   post:
   *     tags: [Authentication]
   *     summary: Logout and revoke session
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [refreshToken]
   *             properties:
   *               refreshToken:
   *                 type: string
   *     responses:
   *       200:
   *         description: Logged out successfully
   *       400:
   *         description: Missing refreshToken
   *       401:
   *         description: Missing or invalid access token
   */
  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as { refreshToken: string };
      const result = await this.logoutService.execute({
        refreshToken: body.refreshToken,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
