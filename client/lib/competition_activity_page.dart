import 'package:flutter/material.dart';
import 'api.dart';
import 'competition_play_page.dart';

class CompetitionActivityPage extends StatefulWidget {
  final QuizApi api;
  final bool reminders;
  const CompetitionActivityPage({super.key,required this.api,this.reminders=false});
  @override
  State<CompetitionActivityPage> createState()=>_CompetitionActivityPageState();
}
class _CompetitionActivityPageState extends State<CompetitionActivityPage> {
  final List<dynamic> items=[];
  int? next=0;
  bool busy=false;
  String? error;
  @override
  void initState(){super.initState();load();}
  Future<void> load() async {
    if(busy || next==null)return;
    setState((){busy=true;error=null;});
    try{
      final path=widget.reminders?'competition-notifications':'competitions';
      final data=await widget.api.call('/v1/me/$path?limit=25&offset=$next');
      if(mounted)setState((){items.addAll(data['items'] as List<dynamic>);next=data['nextOffset'] as int?;});
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  @override
  Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:Text(widget.reminders?'Rappels de compétition':'Mon historique')),
    body:ListView(padding:const EdgeInsets.all(20),children:[
      if(busy)const LinearProgressIndicator(),
      if(error!=null)Text(error!),
      if(!busy && error==null && items.isEmpty)const Text('Aucun élément.'),
      for(final item in items)Card(child:ListTile(
        title:Text('${item['title']}'),
        subtitle:Text(widget.reminders
          ? "${item['kind']=='one_hour'?'Rappel à 1 h':'Rappel à 5 min'} • ${item['starts_at']} • ${item['time_zone']}"
          : "${item['state']} • Rang : ${item['final_rank']??'—'} • ${item['golden_awarded']} Golden crédités${item['refunded_at']!=null?' • Inscription remboursée':''}"),
        onTap:()=>Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>CompetitionPlayPage(api:widget.api,id:(item['competition_id']??item['id']) as String))),
      )),
      if(next!=null)TextButton(onPressed:busy?null:load,child:Text(error==null?'Charger la suite':'Réessayer')),
    ]),
  );
}
