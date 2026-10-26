import 'package:flutter/material.dart';
import 'api.dart';

class LeaderboardsPage extends StatefulWidget {
  final QuizApi api;
  const LeaderboardsPage({super.key, required this.api});
  @override
  State<LeaderboardsPage> createState() => _LeaderboardsPageState();
}
class _LeaderboardsPageState extends State<LeaderboardsPage> {
  String period = 'all';
  late Future<Map<String, dynamic>> ranking;
  @override
  void initState() { super.initState(); ranking = _load(); }
  Future<Map<String, dynamic>> _load() => widget.api.call('/v1/leaderboards?period=$period');
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Hall of Fame')),
    body: ListView(padding: const EdgeInsets.all(20), children: [
      DropdownButton<String>(value: period, items: const [DropdownMenuItem(value: 'all', child: Text('Hall of Fame')), DropdownMenuItem(value: 'week', child: Text('Semaine UTC')), DropdownMenuItem(value: 'month', child: Text('Mois UTC'))], onChanged: (value) { if (value != null) setState(() { period = value; ranking = _load(); }); }),
      FutureBuilder<Map<String, dynamic>>(future: ranking, builder: (context, snapshot) {
        if (snapshot.hasError) return Column(children: [Text('${snapshot.error}'), TextButton(onPressed: () => setState(() => ranking = _load()), child: const Text('Réessayer'))]);
        if (!snapshot.hasData) return const LinearProgressIndicator();
        final rows = snapshot.data!['ranking'] as List<dynamic>;
        return Column(children: [if (rows.isEmpty) const Text('Aucun vainqueur pour cette période.'), for (final entry in rows.asMap().entries) ListTile(leading: Text('${entry.key + 1}'), title: Text(entry.value['pseudo'] as String), trailing: Text('${entry.value['wins']} victoires'))]);
      }),
    ]),
  );
}
