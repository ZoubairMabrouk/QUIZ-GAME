import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/widgets.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'api.dart';

int serverMillis(dynamic value) => value is num
    ? value.toInt()
    : DateTime.parse(value as String).millisecondsSinceEpoch;

bool acceptsSnapshot(Map<String, dynamic>? old, Map<String, dynamic> next) {
  if (old == null) return true;
  final revision = (next['revision'] as num).compareTo(old['revision'] as num);
  if (revision == 0) {
    final personal = (next['personalRevision'] as num? ?? 0).compareTo(old['personalRevision'] as num? ?? 0);
    if (personal != 0) return personal > 0;
  }
  return revision > 0 || (revision == 0 && serverMillis(next['serverTime']) >= serverMillis(old['serverTime']));
}

Duration reconnectDelay(int attempts, Random random) => Duration(
    milliseconds: (min(15000, 1000 * pow(2, min(attempts, 4))) * (0.5 + random.nextDouble() * 0.5)).round());

/// Shared lifecycle for rooms and competitions. Answers are never auto-replayed.
class RealtimeClient with WidgetsBindingObserver {
  final QuizApi api;
  final Map<String, dynamic> Function() subscribe;
  final void Function(Map<String, dynamic>) onMessage;
  final void Function(bool) onLive;
  final Future<void> Function() repair;
  final Random _random = Random();
  final Stopwatch _clock = Stopwatch()..start();
  WebSocketChannel? _socket;
  StreamSubscription<dynamic>? _subscription;
  Timer? _retry, _heartbeat, _repair;
  int _generation = 0, _attempts = 0, _lastMessage = 0;
  bool _closed = false, _paused = false;
  RealtimeClient({required this.api, required this.subscribe, required this.onMessage,
    required this.onLive, required this.repair}) {
    WidgetsBinding.instance.addObserver(this);
    _repair = Timer.periodic(const Duration(seconds: 30), (_) { if (!_paused && !_closed) unawaited(repair()); });
  }
  Future<void> connect() async {
    if (_closed || _paused) return;
    final generation = ++_generation;
    _retry?.cancel(); _heartbeat?.cancel();
    await _subscription?.cancel();
    unawaited(_socket?.sink.close());
    onLive(false);
    try {
      await api.ensureSession();
      if (_closed || generation != _generation) return;
      final socket = WebSocketChannel.connect(api.socketUrl);
      _socket = socket;
      await socket.ready.timeout(const Duration(seconds: 8));
      if (_closed || generation != _generation) { unawaited(socket.sink.close()); return; }
      _lastMessage = _clock.elapsedMilliseconds;
      _subscription = socket.stream.listen((raw) {
        if (_closed || generation != _generation) return;
        _lastMessage = _clock.elapsedMilliseconds;
        try {
          final message = jsonDecode(raw as String) as Map<String, dynamic>;
          if (message['type'] == 'authenticated') {
            _attempts = 0; onLive(true);
            socket.sink.add(jsonEncode(subscribe()));
            unawaited(repair());
          } else if (message['type'] == 'error' && message['status'] == 401) {
            api.expiresAt = DateTime.fromMillisecondsSinceEpoch(0);
            _reconnect(generation);
          }
          onMessage(message);
        } catch (_) { _reconnect(generation); }
      }, onError: (_) => _reconnect(generation), onDone: () {
        if (socket.closeCode == 4401) api.expiresAt = DateTime.fromMillisecondsSinceEpoch(0);
        _reconnect(generation);
      });
      socket.sink.add(jsonEncode({'type':'auth', 'accessToken':api.accessToken}));
      _heartbeat = Timer.periodic(const Duration(seconds: 5), (_) {
        if (_closed || generation != _generation) return;
        if (_clock.elapsedMilliseconds - _lastMessage > 15000 ||
            (api.expiresAt?.difference(DateTime.now()).inSeconds ?? 0) < 45) {
          _reconnect(generation);
        } else { socket.sink.add(jsonEncode({'type':'ping', 'clientTime':_clock.elapsedMilliseconds})); }
      });
    } catch (_) { _reconnect(generation); }
  }
  void _reconnect(int generation) {
    if (_closed || _paused || generation != _generation) return;
    ++_generation;
    _heartbeat?.cancel(); onLive(false);
    unawaited(_subscription?.cancel()); unawaited(_socket?.sink.close());
    if (!api.signedIn) return;
    _retry?.cancel();
    _retry = Timer(reconnectDelay(_attempts++, _random), () => unawaited(connect()));
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_closed) return;
    if (state == AppLifecycleState.resumed) {
      _paused = false; unawaited(repair()); unawaited(connect());
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden || state == AppLifecycleState.detached) {
      _paused = true; ++_generation; _retry?.cancel(); _heartbeat?.cancel();
      onLive(false); unawaited(_subscription?.cancel()); unawaited(_socket?.sink.close());
    }
  }
  void close() {
    _closed = true; ++_generation;
    WidgetsBinding.instance.removeObserver(this);
    _retry?.cancel(); _heartbeat?.cancel(); _repair?.cancel();
    unawaited(_subscription?.cancel()); unawaited(_socket?.sink.close());
  }
}
