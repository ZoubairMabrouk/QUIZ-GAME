import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'api.dart';

class CompetitionPlayPage extends StatefulWidget {
  final QuizApi api;
  final String id;
  final bool enableRealtime;
  const CompetitionPlayPage({super.key, required this.api, required this.id, this.enableRealtime = true});
  @override
  State<CompetitionPlayPage> createState() => _CompetitionPlayPageState();
}

class _CompetitionPlayPageState extends State<CompetitionPlayPage> {
  Map<String, dynamic>? state;
  String? error;
  bool loading = false, answering = false;
  Timer? repair, clock;
  WebSocketChannel? channel;
  StreamSubscription<dynamic>? subscription;
  int serverOffset = 0;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
    if (widget.enableRealtime) unawaited(_connect());
    repair = Timer.periodic(const Duration(seconds: 5), (_) {
      unawaited(_load());
      if (widget.enableRealtime && channel == null) unawaited(_connect());
    });
    clock = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
  }
  void _accept(Map<String, dynamic> next) {
    if (!mounted || (state != null && (next['revision'] as num) < (state!['revision'] as num))) return;
    setState(() {
      state = next;
      error = null;
      serverOffset = DateTime.parse(next['serverTime'] as String).millisecondsSinceEpoch - DateTime.now().millisecondsSinceEpoch;
    });
  }
  Future<void> _load() async {
    if (loading) return;
    loading = true;
    try { _accept(await widget.api.call('/v1/competitions/${widget.id}/play')); }
    catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { loading = false; }
  }
  Future<void> _connect() async {
    if (channel != null || !mounted) return;
    try {
      await widget.api.ensureSession();
      if (!mounted || channel != null) return;
      final socket = WebSocketChannel.connect(widget.api.socketUrl);
      channel = socket;
      await socket.ready;
      if (!mounted) { await socket.sink.close(); return; }
      subscription = socket.stream.listen((raw) {
        final message = jsonDecode(raw as String) as Map<String, dynamic>;
        if (message['type'] == 'authenticated') {
          socket.sink.add(jsonEncode({'type': 'competition.subscribe', 'id': widget.id}));
        } else if (message['type'] == 'competition.state') {
          _accept(Map<String, dynamic>.from(message['state'] as Map));
        } else if (message['type'] == 'competition.updated') {
          unawaited(_load());
        } else if (message['type'] == 'error') {
          if (mounted) setState(() => error = message['message'] as String?);
        }
      }, onError: (_) { if (identical(channel, socket)) channel = null; }, onDone: () { if (identical(channel, socket)) channel = null; });
      socket.sink.add(jsonEncode({'type': 'auth', 'accessToken': widget.api.accessToken}));
    } catch (_) { channel = null; }
  }
  Future<void> _answer(int choice) async {
    if (answering || state == null) return;
    setState(() { answering = true; error = null; });
    try {
      final questionNo = state!['questionNo'];
      final accepted = await widget.api.call('/v1/competitions/${widget.id}/answers', body: {'questionNo': questionNo, 'choice': choice});
      if (mounted && state?['questionNo'] == questionNo) setState(() { state = {...state!, 'myChoice': choice, 'revision': accepted['revision'] ?? state!['revision']}; });
      await _load();
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => answering = false); }
  }
  @override
  void dispose() {
    repair?.cancel(); clock?.cancel();
    unawaited(subscription?.cancel()); unawaited(channel?.sink.close());
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    final s = state;
    final now = DateTime.fromMillisecondsSinceEpoch(DateTime.now().millisecondsSinceEpoch + serverOffset);
    final deadline = s?['deadline'] == null ? null : DateTime.parse(s!['deadline'] as String);
    final seconds = deadline == null ? 0 : (deadline.difference(now).inMilliseconds / 1000).ceil().clamp(0, 10);
    final me = s?['me'] as Map<String, dynamic>?;
    final q = s?['question'] as Map<String, dynamic>?;
    final correction = s?['correction'] as Map<String, dynamic>?;
    final canAnswer = s != null && ['PHASE_1', 'PHASE_2'].contains(s['state']) && me?['eliminated'] == false && s['myChoice'] == null && s['nextTransitionAt'] == null && seconds > 0;
    return Scaffold(
      appBar: AppBar(title: Text(s?['title'] as String? ?? 'Compétition'), actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh), tooltip: 'Actualiser')]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        if (s == null) const LinearProgressIndicator(),
        if (error != null) Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        if (s != null) ...[
          Text('${s['state']}', style: Theme.of(context).textTheme.headlineSmall),
          Text('${s['survivors']} en lice sur ${s['participants']} inscrits'),
          if (me?['eliminated'] == true) Text('Mode spectateur • Rang : ${me?['rank']}'),
          if (me?['milestoneAwarded'] == true) const Text('Récompense de palier attribuée au portefeuille'),
          if (['PLANIFIEE', 'INSCRIPTIONS_OUVERTES', 'INSCRIPTIONS_CLOSES'].contains(s['state'])) Text('Départ dans ${DateTime.parse(s['startsAt'] as String).difference(now).inSeconds.clamp(0, 999999)} s'),
          if (s['state'] == 'PALIER_ATTEINT') const Text('Palier atteint ! Préparation de la finale…'),
          if (s['state'] == 'ANNULEE') const Text('Compétition annulée. Les frais d’inscription sont remboursés.'),
          if (q != null) ...[
            const SizedBox(height: 20),
            Text(q['text'] as String, style: Theme.of(context).textTheme.titleLarge),
            Text(seconds > 0 && correction == null ? '$seconds s' : 'Réponses fermées'),
            for (final entry in (q['choices'] as List<dynamic>).asMap().entries)
              Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: OutlinedButton(onPressed: canAnswer && !answering ? () => _answer(entry.key) : null, child: Text('${entry.value}${s['myChoice'] == entry.key ? ' • Votre réponse' : ''}${correction?['correctIndex'] == entry.key ? ' ✓' : ''}'))),
            if (s['myChoice'] != null && correction == null) const Text('Réponse enregistrée. Correction à la clôture.'),
            if (seconds == 0 && correction == null) const Text('Clôture en cours ; reconnexion possible sans réponse tardive.'),
            if (correction != null) Text(correction['explanation'] as String),
          ],
          if (s['state'] == 'TERMINEE') ...[
            const SizedBox(height: 20),
            Text('Votre rang : ${me?['rank']}', style: Theme.of(context).textTheme.titleLarge),
            for (final reward in s['rewards'] as List<dynamic>) Text('+${reward['amount']} ${reward['currency']} • ${reward['reason']}'),
            for (final result in s['results'] as List<dynamic>) ListTile(title: Text('${result['rank']}. ${result['pseudo']}'), subtitle: Text('${result['cumulative_ms']} ms cumulées')),
            ExpansionTile(title: const Text('Vérifier le départage'), children: [SelectableText('Engagement : ${s['tieCommitment']}\nGraine : ${s['tieSeed']}\nMotif : ${s['resolutionReason']}')]),
          ],
        ],
      ]),
    );
  }
}
