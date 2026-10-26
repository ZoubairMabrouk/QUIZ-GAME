import 'package:flutter/material.dart';
import 'api.dart';
import 'competition_play_page.dart';
import 'leaderboards_page.dart';

class CompetitionsPage extends StatefulWidget {
  final QuizApi api;
  const CompetitionsPage({super.key, required this.api});
  @override
  State<CompetitionsPage> createState() => _CompetitionsPageState();
}

class _CompetitionsPageState extends State<CompetitionsPage> {
  List<dynamic> events = [];
  int balance = 0;
  bool busy = true;
  String? error;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    setState(() { busy = true; error = null; });
    try {
      final results = await Future.wait([
        widget.api.call('/v1/competitions'), widget.api.call('/wallet'),
      ]);
      if (!mounted) return;
      setState(() { events = results[0]['competitions'] as List<dynamic>; balance = (results[1]['silver'] as num).toInt(); });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> _register(Map<String, dynamic> event) async {
    setState(() { busy = true; error = null; });
    try {
      await widget.api.call('/v1/competitions/${event['id']}/register', body: {});
      if (mounted) await _load();
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Compétitions'), actions: [IconButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LeaderboardsPage(api: widget.api))), icon: const Icon(Icons.emoji_events_outlined), tooltip: 'Hall of Fame'), IconButton(onPressed: busy ? null : _load, icon: const Icon(Icons.refresh), tooltip: 'Actualiser')]),
    body: ListView(padding: const EdgeInsets.all(20), children: [
      Text('Solde : $balance Silver', style: Theme.of(context).textTheme.titleLarge),
      const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('Inscrivez-vous avant la fermeture. Répondez en dix secondes et suivez votre classement.')),
      if (busy) const LinearProgressIndicator(),
      if (error != null) Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      if (!busy && events.isEmpty) const Text('Aucune compétition planifiée.'),
      for (final raw in events) _event(Map<String, dynamic>.from(raw as Map)),
    ]),
  );
  Widget _event(Map<String, dynamic> event) {
    final start = DateTime.parse(event['starts_at'] as String).toLocal();
    final registered = event['registered_at'] != null;
    final refunded = event['refunded_at'] != null;
    final serverTime = DateTime.parse(event['server_time'] as String);
    final open = event['state'] == 'INSCRIPTIONS_OUVERTES' && serverTime.isBefore(start.subtract(const Duration(minutes: 5)));
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(event['title'] as String, style: Theme.of(context).textTheme.titleLarge),
      Text('$start (heure locale) • Fuseau de planification : ${event['time_zone']}'),
      Text('${event['participants']} participants • ${event['silver_cost']} Silver'),
      Text('${event['state']}'),
      if (registered) Text(refunded ? 'Inscription remboursée' : 'Inscription confirmée'),
      if (registered && !refunded) FilledButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CompetitionPlayPage(api: widget.api, id: event['id'] as String))), child: const Text('Entrer / Reprendre')),
      if (!registered && open) FilledButton(onPressed: busy || balance < (event['silver_cost'] as num) ? null : () => _register(event), child: Text('S’inscrire • ${event['silver_cost']} Silver')),
    ])));
  }
}
