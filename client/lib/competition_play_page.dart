import 'dart:async';
import 'package:flutter/material.dart';
import 'realtime_client.dart';
import 'api.dart';
import 'question_media.dart';

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
  bool reloadPending = false;
  Timer? repair, clock;
  RealtimeClient? realtime;
  bool live = false;
  final Stopwatch serverClock = Stopwatch()..start();
  int sampledServerTime = 0, sampledAt = 0;
  int eventRevision = -1;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
    if (widget.enableRealtime) unawaited(_connect());
    if (!widget.enableRealtime) repair = Timer.periodic(const Duration(seconds: 30), (_) => unawaited(_load()));
    clock = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
  }
  void _accept(Map<String, dynamic> next) {
    if (!mounted || !acceptsSnapshot(state, next)) return;
    setState(() {
      state = next;
      error = null;
      sampledServerTime = serverMillis(next['serverTime']);
      sampledAt = serverClock.elapsedMilliseconds;
    });
  }
  Future<void> _load() async {
    if (loading) { reloadPending=true; return; }
    loading = true;
    try { _accept(await widget.api.call('/v1/competitions/${widget.id}/play')); }
    catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { loading = false; if(reloadPending && mounted){reloadPending=false;unawaited(_load());} }
  }
  Future<void> _connect() async {
    realtime = RealtimeClient(api: widget.api,
      subscribe: () => {'type':'competition.subscribe', 'id':widget.id, if(eventRevision>=0) 'afterRevision':eventRevision},
      onLive: (value) { if(mounted) setState(() => live=value); },
      repair: _load,
      onMessage: (message) {
        if(message['type']=='competition.state') _accept(Map<String,dynamic>.from(message['state'] as Map));
        if(message['type']=='competition.updated') {
          final revision=(message['revision'] as num).toInt();
          if(revision>eventRevision) { eventRevision=revision; unawaited(_load()); }
        }
        if(message['type']=='error' && mounted) setState(() => error=message['message'] as String?);
      });
    await realtime!.connect();
  }
  Future<void> _answer(int choice) async {
    if (answering || state == null) return;
    setState(() { answering = true; error = null; });
    try {
      final questionNo = state!['questionNo'];
      final accepted = await widget.api.call('/v1/competitions/${widget.id}/answers', body: {'questionNo': questionNo, 'choice': choice});
      if (mounted && state?['questionNo'] == questionNo && (accepted['revision'] as num? ?? state!['revision'] as num) >= (state!['revision'] as num)) setState(() { state = {...state!, 'myChoice': choice, 'revision': accepted['revision'] ?? state!['revision'], 'personalRevision': accepted['personalRevision'] ?? state!['personalRevision']}; });
      await _load();
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => answering = false); }
  }
  @override
  void dispose() {
    repair?.cancel(); clock?.cancel();
    realtime?.close();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    final s = state;
    final now = DateTime.fromMillisecondsSinceEpoch(sampledServerTime + serverClock.elapsedMilliseconds - sampledAt);
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
        if (widget.enableRealtime && !live) const Text('Connexion interrompue : reprise en cours.'),
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
            QuestionMedia(media:q['media']),
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
