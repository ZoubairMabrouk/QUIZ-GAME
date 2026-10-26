import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'realtime_client.dart';

import 'api.dart';

class GameController extends ChangeNotifier {
  final QuizApi api;
  GameController(this.api) {
    _ticker = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (room != null || challengeId != null) notifyListeners();
    });
  }
  Map<String, dynamic>? user, room, wallet, configuration;
  String? challengeId, error, roomCode;
  String? pendingRoomCode;
  bool busy = false, live = false;
  int attempts = 0;
  DateTime? resendAt;
  Timer? _ticker;
  RealtimeClient? _realtime;
  final Stopwatch _clock = Stopwatch()..start();
  int _receivedAt = 0;
  bool _disposed = false;
  bool get mock => configuration?['otpMode'] == 'mock';
  List<String> get channels =>
      List<String>.from(configuration?['channels'] ?? ['sms']);
  String get status => room?['status'] as String? ?? '';
  bool get isHost => room?['hostId'] == user?['id'];
  int get secondsLeft => math
      .max(
        0,
        ((room?['remainingMs'] as num? ?? 0).toDouble() -
                (_clock.elapsedMilliseconds - _receivedAt)) /
            1000,
      )
      .ceil();
  int get resendSeconds =>
      math.max(0, (resendAt?.difference(DateTime.now()).inSeconds ?? 0) + 1);
  List<Map<String, dynamic>> get players =>
      (room?['players'] as List? ?? []).cast<Map<String, dynamic>>();
  bool get myReady =>
      players.any((p) => p['id'] == user?['id'] && p['ready'] == true);
  bool get canStart =>
      players.length >= 2 && players.every((p) => p['ready'] == true);
  bool get answered => room?['answered'] == true;
  void dismissError() {
    error = null;
    notifyListeners();
  }

  Future<void> run(Future<void> Function() operation) async {
    if (busy) return;
    busy = true;
    error = null;
    notifyListeners();
    try {
      await operation();
    } catch (e) {
      error = e.toString();
      if (e is ApiException &&
          e.status == 401 &&
          !api.signedIn &&
          user != null) {
        disconnect();
        user = null;
        room = null;
        roomCode = null;
        challengeId = null;
      }
    } finally {
      busy = false;
      if (!_disposed) notifyListeners();
    }
  }

  Future<void> initialize() => run(() async {
        configuration = await api.call('/config', auth: false);
      });
  Future<void> requestCode(String phone, String channel, bool consent) =>
      run(() async {
        final result = await api.call(
          '/auth/otp/request',
          body: {'phone': phone.trim(), 'channel': channel, 'consent': consent},
          auth: false,
        );
        challengeId = result['challengeId'] as String;
        resendAt = DateTime.now().add(
          Duration(seconds: result['resendAfter'] as int),
        );
      });
  void changePhone() {
    challengeId = null;
    error = null;
    notifyListeners();
  }

  Future<void> verify(String code) => run(() async {
        final session = await api.call(
          '/auth/otp/verify',
          body: {'challengeId': challengeId, 'code': code.trim()},
          auth: false,
        );
        api.setSession(session);
        user = session['user'] as Map<String, dynamic>;
        challengeId = null;
        wallet = await api.call('/wallet');
        if(pendingRoomCode!=null){final code=pendingRoomCode!;pendingRoomCode=null;_enter(await api.call('/rooms/$code/join',body:{}));}
      });
  Future<void> saveProfile(String pseudo) => run(() async {
        user = await api.call('/me/profile', body: {'pseudo': pseudo.trim()});
      });
  Future<void> createRoom(int count, int duration) => run(() async {
        final state = await api.call(
          '/rooms',
          body: {
            'questionCount': count,
            'durationMs': duration * 1000,
            'maxPlayers': 8,
          },
        );
        _enter(state);
      });
  Future<void> joinRoom(String code) => run(() async {
        final clean = code.trim().toUpperCase();
        if (!RegExp(r'^[A-Z2-9]{6}$').hasMatch(clean)) {
          throw ApiException('Entrez les 6 caractères du code de salle.');
        }
        _enter(await api.call('/rooms/$clean/join', body: {}));
      });
  void _enter(Map<String, dynamic> state) {
    disconnect();
    room = null;
    roomCode = state['code'] as String;
    acceptState(state);
    unawaited(connect());
  }
  void enterRoom(Map<String,dynamic> state)=>_enter(state);
  void clearDeletedAccount(){disconnect();user=null;wallet=null;room=null;roomCode=null;api.clearSession();notifyListeners();}
  Future<void> rematch()=>run(()async{_enter(await api.call('/rooms/$roomCode/rematch',body:{}));});

  void acceptState(Map<String, dynamic> state) {
    if (roomCode != state['code']) return;
    if (!acceptsSnapshot(room, state)) return;
    final wasFinished = status == 'finished';
    room = state;
    _receivedAt = _clock.elapsedMilliseconds;
    if (!wasFinished && status == 'finished') {
      unawaited(_loadWallet());
    }
    if (!_disposed) notifyListeners();
  }

  Future<void> _loadWallet() async {
    try {
      wallet = await api.call('/wallet');
      if (!_disposed) notifyListeners();
    } catch (_) {}
  }

  Future<void> command(String action, [Map<String, dynamic>? payload]) =>
      run(() async {
        if (!live) {
          throw ApiException('Reconnexion en cours. Patientez un instant.');
        }
        final code = roomCode;
        try {
          final result = await api.call(
            '/rooms/$code/$action',
            body: payload ?? {},
          );
          if (result['status'] != null) acceptState(result);
          if (action == 'answers') {
            acceptState(await api.call('/rooms/$code'));
          }
        } catch (_) {
          // Recover state after an ambiguous network failure; never replay an answer automatically.
          try {
            acceptState(await api.call('/rooms/$code'));
          } catch (_) {}
          rethrow;
        }
      });
  Future<void> answer(int choice) async {
    if (answered || secondsLeft <= 0) return;
    await command('answers', {
      'questionId': room!['question']['id'],
      'choice': choice,
    });
  }

  Future<void> connect() async {
    _realtime?.close();
    if (_disposed || roomCode == null || !api.signedIn) return;
    _realtime = RealtimeClient(api: api,
      subscribe: () => {'type':'subscribe', 'code':roomCode},
      onLive: (value) { live=value; if (!_disposed) notifyListeners(); },
      repair: () async {
        try { final code=roomCode; if(code != null) acceptState(await api.call('/rooms/$code')); } catch (_) {}
      },
      onMessage: (message) {
        if (message['type']=='room.state') acceptState(Map<String,dynamic>.from(message['state'] as Map));
        if (message['type']=='error') { error=message['message'] as String?; if(!_disposed) notifyListeners(); }
      });
    await _realtime!.connect();
  }

  void disconnect() {
    _realtime?.close(); _realtime=null; live=false;
  }

  void home() {
    disconnect();
    roomCode = null;
    room = null;
    notifyListeners();
  }

  Future<void> logout() => run(() async {
        try {
          await api.call('/auth/logout', body: {});
        } finally {
          disconnect();
          api.clearSession();
          user = null;
          room = null;
          roomCode = null;
          wallet = null;
        }
      });
  @override
  void dispose() {
    _disposed = true;
    _ticker?.cancel();
    disconnect();
    api.dispose();
    super.dispose();
  }
}
