import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

class ApiException implements Exception {
  final String message;
  final int status;
  ApiException(this.message, [this.status = 0]);
  @override
  String toString() => message;
}

class QuizApi {
  final String baseUrl;
  final http.Client client;
  String? accessToken, refreshToken;
  DateTime? expiresAt;
  Future<void>? _refreshing;
  QuizApi(this.baseUrl, {http.Client? client})
      : client = client ?? http.Client();
  bool get signedIn => accessToken != null;
  Uri get socketUrl {
    final uri = Uri.parse(baseUrl);
    return uri.replace(
      scheme: uri.scheme == 'https' ? 'wss' : 'ws',
      path: '/ws',
      query: null,
    );
  }

  void setSession(Map<String, dynamic> json) {
    accessToken = json['accessToken'] as String;
    refreshToken = json['refreshToken'] as String;
    expiresAt = DateTime.parse(json['expiresAt'] as String);
  }

  void clearSession() {
    accessToken = null;
    refreshToken = null;
    expiresAt = null;
  }

  Future<void> ensureSession({bool force = false}) async {
    if (!signedIn) throw ApiException('Reconnectez-vous pour continuer.', 401);
    if (!force &&
        expiresAt!.isAfter(
          DateTime.now().toUtc().add(const Duration(seconds: 45)),
        )) {
      return;
    }
    if (_refreshing != null) return _refreshing;
    final operation = _refresh();
    _refreshing = operation;
    try {
      await operation;
    } finally {
      _refreshing = null;
    }
  }

  Future<void> _refresh() async {
    try {
      setSession(
        await _request('/auth/refresh', body: {'refreshToken': refreshToken}),
      );
    } catch (_) {
      // A lost rotation response is ambiguous: never replay a used refresh token.
      clearSession();
      throw ApiException(
        'Session à renouveler. Reconnectez-vous avec un code.',
        401,
      );
    }
  }

  Future<Map<String, dynamic>> call(
    String path, {
    Map<String, dynamic>? body,
    bool auth = true,
  }) async {
    if (auth) await ensureSession();
    try {
      return await _request(path, body: body, token: auth ? accessToken : null);
    } on ApiException catch (e) {
      if (!auth || e.status != 401) rethrow;
      await ensureSession(force: true);
      return _request(path, body: body, token: accessToken);
    }
  }

  Future<Map<String, dynamic>> _request(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    try {
      final headers = {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };
      final uri = Uri.parse('$baseUrl$path');
      final response = await (body == null
              ? client.get(uri, headers: headers)
              : client.post(uri, headers: headers, body: jsonEncode(body)))
          .timeout(const Duration(seconds: 12));
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 400) {
        throw ApiException(
          _friendly(decoded['error'] as String? ?? 'Une erreur est survenue.'),
          response.statusCode,
        );
      }
      return decoded;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException(
        'Le serveur ne répond pas. Vérifiez la connexion avant de réessayer.',
      );
    } catch (_) {
      throw ApiException(
        'Connexion impossible. Vérifiez l’adresse du serveur {$baseUrl} et votre réseau.',
      );
    }
  }

  String _friendly(String message) =>
      {
        'Invalid or expired code': 'Code incorrect ou expiré.',
        'Room not found': 'Cette salle est introuvable. Vérifiez le code.',
        'Room already started': 'Cette partie a déjà commencé.',
        'Room full': 'Cette salle est complète.',
        'Question closed': 'Le temps est écoulé pour cette question.',
        'Already answered': 'Votre réponse a déjà été enregistrée.',
        'Pseudo already used': 'Ce pseudo est déjà utilisé.',
        'Too many attempts; try later':
            'Trop de tentatives. Patientez avant de réessayer.',
        'Wait 60 seconds before requesting another code':
            'Attendez une minute avant de demander un nouveau code.',
        'Number not allowed in mock mode':
            'En mode test, utilisez +12025550123 ou +12025550124.',
        'Invalid phone number': 'Ce numéro ne semble pas valide.',
        'Country not enabled': 'Ce pays n’est pas encore activé.',
        'Channel not enabled': 'Ce canal n’est pas activé sur le serveur.',
        'Consent is required to send a verification code':
            'Votre accord est nécessaire pour envoyer le code.',
      }[message] ??
      message;
  void dispose() {
    client.close();
  }
}
