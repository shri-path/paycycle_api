/**
 * VoiceController — HTTP handlers (arrow functions, try/catch → next(error)).
 * No business logic; only: extract validated inputs → call use case → format response.
 */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendCreated } from '@/common/api-wrapper/response.util';
import { GetLanguagePreferenceQuery } from './queries/get-language-preference/get-language-preference.query';
import { UpsertLanguagePreferenceCommand } from './commands/upsert-language-preference/upsert-language-preference.command';
import { ListMessageTemplatesQuery } from './queries/list-message-templates/list-message-templates.query';
import { UpsertMessageTemplateCommand } from './commands/upsert-message-template/upsert-message-template.command';
import { PreviewMessageTemplateQuery } from './queries/preview-message-template/preview-message-template.query';
import { TranscribeVoiceCommandCommand } from './commands/transcribe-voice-command/transcribe-voice-command.command';
import { ExecuteVoiceCommandCommand } from './commands/execute-voice-command/execute-voice-command.command';

export class VoiceController {
  constructor(
    private readonly getLanguagePrefQuery: GetLanguagePreferenceQuery,
    private readonly upsertLanguagePrefCmd: UpsertLanguagePreferenceCommand,
    private readonly listTemplatesQuery: ListMessageTemplatesQuery,
    private readonly upsertTemplateCmd: UpsertMessageTemplateCommand,
    private readonly previewTemplateQuery: PreviewMessageTemplateQuery,
    private readonly transcribeCmd: TranscribeVoiceCommandCommand,
    private readonly executeCmd: ExecuteVoiceCommandCommand
  ) {}

  // ── 1.1 GET /users/:userId/language-preferences ───────────────────────────

  /**
   * @openapi
   * /users/{userId}/language-preferences:
   *   get:
   *     tags: [Voice & Language]
   *     summary: Get user language and voice preferences (returns defaults if not set)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Language preferences }
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden (not self) }
   */
  getLanguagePreference = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = BigInt(req.params['userId']!);
      const callerId = req.user!.userId;

      const result = await this.getLanguagePrefQuery.execute(userId, callerId);
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  // ── 1.2 PATCH /users/:userId/language-preferences ─────────────────────────

  /**
   * @openapi
   * /users/{userId}/language-preferences:
   *   patch:
   *     tags: [Voice & Language]
   *     summary: Create or update user language preferences
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               appLanguage: { type: string, enum: [en,hi,ta,te,mr,bn,kn,ml,gu] }
   *               secondaryLanguage: { type: string, nullable: true }
   *               voiceCommandsEnabled: { type: boolean }
   *               voiceResponsesEnabled: { type: boolean }
   *               transliterationEnabled: { type: boolean }
   *               billLanguageDefault: { type: string, enum: [customer,my_language,english] }
   *               preferredVoiceAccent: { type: string, nullable: true }
   *     responses:
   *       200: { description: Updated preferences }
   *       400: { description: Validation error }
   *       403: { description: Forbidden }
   */
  upsertLanguagePreference = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = BigInt(req.params['userId']!);
      const callerId = req.user!.userId;
      const body = req.body as Record<string, unknown>;

      // Normalize enum values to uppercase for domain
      const patch: Record<string, unknown> = {};
      if (body['appLanguage'] !== undefined)
        patch['appLanguage'] = String(body['appLanguage']).toUpperCase();
      if (body['secondaryLanguage'] !== undefined) {
        patch['secondaryLanguage'] =
          body['secondaryLanguage'] != null
            ? String(body['secondaryLanguage']).toUpperCase()
            : null;
      }
      if (body['voiceCommandsEnabled'] !== undefined)
        patch['voiceCommandsEnabled'] = body['voiceCommandsEnabled'];
      if (body['voiceResponsesEnabled'] !== undefined)
        patch['voiceResponsesEnabled'] = body['voiceResponsesEnabled'];
      if (body['transliterationEnabled'] !== undefined)
        patch['transliterationEnabled'] = body['transliterationEnabled'];
      if (body['billLanguageDefault'] !== undefined) {
        // e.g. 'my_language' → 'MY_LANGUAGE'
        patch['billLanguageDefault'] = String(body['billLanguageDefault']).toUpperCase();
      }
      if (body['preferredVoiceAccent'] !== undefined)
        patch['preferredVoiceAccent'] = body['preferredVoiceAccent'];

      const result = await this.upsertLanguagePrefCmd.execute({
        userId,
        callerId,
        patch: patch as Parameters<typeof this.upsertLanguagePrefCmd.execute>[0]['patch'],
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  // ── 2.1 GET /vendors/:vendorId/message-templates ──────────────────────────

  /**
   * @openapi
   * /vendors/{vendorId}/message-templates:
   *   get:
   *     tags: [Voice & Language]
   *     summary: List vendor message templates
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: templateType
   *         schema: { type: string }
   *       - in: query
   *         name: languageCode
   *         schema: { type: string }
   *     responses:
   *       200: { description: Templates list }
   *       403: { description: Forbidden }
   */
  listTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const { templateType, languageCode } = req.query as Record<string, string | undefined>;

      const templates = await this.listTemplatesQuery.execute({
        vendorId,
        templateType,
        languageCode,
      });
      sendSuccess(res, { templates });
    } catch (e) {
      next(e);
    }
  };

  // ── 2.2 PUT /vendors/:vendorId/message-templates ─────────────────────────

  /**
   * @openapi
   * /vendors/{vendorId}/message-templates:
   *   put:
   *     tags: [Voice & Language]
   *     summary: Create or update a message template (upsert by type+language)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [templateType, languageCode, content]
   *             properties:
   *               templateType: { type: string }
   *               languageCode: { type: string }
   *               content: { type: string, maxLength: 2000 }
   *     responses:
   *       200: { description: Updated template }
   *       201: { description: Created template }
   *       400: { description: Validation / invalid placeholder }
   *       409: { description: Conflict }
   */
  upsertTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const body = req.body as { templateType: string; languageCode: string; content: string };

      const { dto, created } = await this.upsertTemplateCmd.execute({
        vendorId,
        templateType: body.templateType,
        languageCode: body.languageCode,
        content: body.content,
      });

      if (created) {
        sendCreated(res, dto);
      } else {
        sendSuccess(res, dto);
      }
    } catch (e) {
      next(e);
    }
  };

  // ── 2.3 POST /vendors/:vendorId/message-templates/preview ────────────────

  /**
   * @openapi
   * /vendors/{vendorId}/message-templates/preview:
   *   post:
   *     tags: [Voice & Language]
   *     summary: Preview a message template with sample data (no save)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [templateType, languageCode]
   *             properties:
   *               templateType: { type: string }
   *               languageCode: { type: string }
   *               content: { type: string }
   *               sampleData: { type: object }
   *     responses:
   *       200: { description: Rendered preview }
   *       400: { description: Validation error }
   *       404: { description: No saved template found }
   */
  previewTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const body = req.body as {
        templateType: string;
        languageCode: string;
        content?: string;
        sampleData?: Record<string, string>;
      };

      const result = await this.previewTemplateQuery.execute({
        vendorId,
        templateType: body.templateType,
        languageCode: body.languageCode,
        content: body.content,
        sampleData: body.sampleData,
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  // ── 3.1 POST /voice/transcribe ────────────────────────────────────────────

  /**
   * @openapi
   * /voice/transcribe:
   *   post:
   *     tags: [Voice & Language]
   *     summary: Transcribe audio and interpret the voice command
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [audioData, languageCode, supplyListId]
   *             properties:
   *               audioData: { type: string, description: base64-encoded audio }
   *               languageCode: { type: string }
   *               supplyListId: { type: string }
   *               serviceDate: { type: string, format: date }
   *     responses:
   *       200: { description: Transcription and interpretation }
   *       400: { description: Validation error }
   *       429: { description: Rate limited }
   *       502: { description: Speech provider error }
   */
  transcribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vendorId = req.roleContext!.vendorId;
      const body = req.body as {
        audioData: string;
        languageCode: string;
        supplyListId: bigint;
        serviceDate?: string;
      };

      const result = await this.transcribeCmd.execute({
        userId,
        vendorId,
        audioData: body.audioData,
        languageCode: body.languageCode,
        supplyListId: body.supplyListId,
        serviceDate: body.serviceDate,
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  // ── 3.2 POST /voice/execute-command ──────────────────────────────────────

  /**
   * @openapi
   * /voice/execute-command:
   *   post:
   *     tags: [Voice & Language]
   *     summary: Execute an interpreted voice command (marks delivery)
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [interpretation, supplyListId]
   *             properties:
   *               interpretation:
   *                 type: object
   *                 properties:
   *                   action: { type: string }
   *                   customerId: { type: string, nullable: true }
   *                   quantity: { type: number, nullable: true }
   *               supplyListId: { type: string }
   *               serviceDate: { type: string, format: date }
   *               logId: { type: string }
   *     responses:
   *       200: { description: Execution result }
   *       404: { description: No pending delivery found }
   *       409: { description: Delivery already in requested state }
   *       422: { description: Unprocessable command }
   */
  executeCommand = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vendorId = req.roleContext!.vendorId;
      const body = req.body as {
        interpretation: { action: string; customerId?: bigint | null; quantity?: number | null };
        supplyListId: bigint;
        serviceDate?: string;
        logId?: bigint;
      };

      const result = await this.executeCmd.execute({
        userId,
        vendorId,
        roleCtx: req.roleContext!,
        interpretation: body.interpretation,
        supplyListId: body.supplyListId,
        serviceDate: body.serviceDate,
        logId: body.logId ?? null,
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };
}
