import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'api.dart';

class PlayerAccountPage extends StatefulWidget {
  final QuizApi api;
  final String userId;
  const PlayerAccountPage({super.key,required this.api,required this.userId});
  @override
  State<PlayerAccountPage> createState()=>_PlayerAccountPageState();
}
class _PlayerAccountPageState extends State<PlayerAccountPage> {
  final pseudo=TextEditingController(),country=TextEditingController(),birth=TextEditingController(),friend=TextEditingController(),inviteCode=TextEditingController();
  Map<String,dynamic>? data;
  List<dynamic> invitations=[];
  String avatar='owl';
  final languages=<String>{'fr'};
  String? error,notice;
  int tab=0,offset=0;
  bool busy=false;
  @override
  void initState(){super.initState();load();}
  Future<void> run(Future<void> Function() action) async {
    if(busy)return;setState((){busy=true;error=null;notice=null;});
    try{await action();}catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> fetch() async {
    final paths=['/me/profile','/wallet?limit=25&offset=$offset','/friends?limit=25&offset=$offset','/me/games?limit=25&offset=$offset'];
    final next=await widget.api.call(paths[tab]);
    final invites=tab==2?await widget.api.call('/invitations'):null;
    if(!mounted)return;
    setState((){
      data=next;invitations=invites?['items'] as List<dynamic>? ?? [];
      if(tab==0){pseudo.text=next['pseudo'] as String;country.text=next['country'] as String? ?? '';birth.text=next['birthDate'] as String? ?? '';avatar=next['avatar'] as String? ?? 'owl';languages..clear()..addAll(List<String>.from(next['languages'] as List? ?? ['fr']));}
    });
  }
  Future<void> load()=>run(fetch);
  Future<void> action(String path,Map<String,dynamic> body)=>run(()async{await widget.api.call(path,body:body);await fetch();if(mounted)setState(()=>notice='Modification confirmée.');});
  Future<void> remove() async {
    final confirmation=TextEditingController();
    final yes=await showDialog<bool>(context:context,builder:(context)=>AlertDialog(title:const Text('Supprimer mon compte'),content:Column(mainAxisSize:MainAxisSize.min,children:[
      const Text('Le profil et les relations seront supprimés. Le ledger et un identifiant anonymisé restent conservés pour l’audit. Terminez vos inscriptions actives. Saisissez DELETE pour confirmer.'),TextField(controller:confirmation,decoration:const InputDecoration(labelText:'Confirmation')),
    ]),actions:[TextButton(onPressed:()=>Navigator.pop(context,false),child:const Text('Annuler')),TextButton(onPressed:()=>Navigator.pop(context,confirmation.text=='DELETE'),child:const Text('Supprimer'))]));
    confirmation.dispose();
    if(yes==true)await run(()async{await widget.api.call('/me/delete',body:{'confirm':'DELETE'});widget.api.clearSession();if(mounted)Navigator.pop(context,{'deleted':true});});
  }
  @override
  void dispose(){for(final c in [pseudo,country,birth,friend,inviteCode]){c.dispose();}super.dispose();}
  @override
  Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('Mon espace'),actions:[IconButton(onPressed:busy?null:load,icon:const Icon(Icons.refresh),tooltip:'Actualiser')]),body:ListView(padding:const EdgeInsets.all(20),children:[
    Wrap(spacing:8,children:[for(final entry in ['Profil','Portefeuille','Amis','Historique'].asMap().entries)ChoiceChip(label:Text(entry.value),selected:tab==entry.key,onSelected:busy?null:(_){setState((){tab=entry.key;offset=0;data=null;});load();})]),
    if(busy)const LinearProgressIndicator(),if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),if(notice!=null)Text(notice!),
    if(data!=null && tab==0)...[
      TextField(controller:pseudo,maxLength:24,decoration:const InputDecoration(labelText:'Pseudo')),
      DropdownButtonFormField<String>(value:avatar,decoration:const InputDecoration(labelText:'Avatar'),items:['owl','fox','cat','lion','star'].map((x)=>DropdownMenuItem(value:x,child:Text(x))).toList(),onChanged:(x)=>setState(()=>avatar=x!)),
      TextField(controller:country,maxLength:2,textCapitalization:TextCapitalization.characters,decoration:const InputDecoration(labelText:'Pays (code ISO à 2 lettres)')),
      TextField(controller:birth,decoration:const InputDecoration(labelText:'Date de naissance facultative (AAAA-MM-JJ)')),
      Wrap(spacing:8,children:[for(final language in ['fr','en','ar'])FilterChip(label:Text(language),selected:languages.contains(language),onSelected:(selected)=>setState((){if(selected){languages.add(language);}else{languages.remove(language);}}))]),
      FilledButton(onPressed:busy?null:()=>action('/me/profile',{'pseudo':pseudo.text,'avatar':avatar,'country':country.text.isEmpty?null:country.text.toUpperCase(),'languages':languages.toList(),'birthDate':birth.text.isEmpty?null:birth.text}),child:const Text('Enregistrer le profil')),
      Text('Parties : ${data!['statistics']['games']} • Victoires : ${data!['statistics']['wins']} • Score : ${data!['statistics']['score']}'),
      Text('Badges : ${(data!['badges'] as List).join(', ')}'),const Text('Cadeaux réels indisponibles. La date de naissance déclarée ne vaut pas vérification d’éligibilité.'),
      OutlinedButton(onPressed:busy?null:()=>run(()async{final exported=await widget.api.call('/me/export');if(!mounted || !context.mounted)return;await showDialog<void>(context:context,builder:(context)=>AlertDialog(title:const Text('Export personnel'),content:SizedBox(width:600,child:SingleChildScrollView(child:SelectableText(const JsonEncoder.withIndent('  ').convert(exported)))),actions:[TextButton(onPressed:()async{await Clipboard.setData(ClipboardData(text:jsonEncode(exported)));},child:const Text('Copier le JSON')),TextButton(onPressed:()=>Navigator.pop(context),child:const Text('Fermer'))]));}),child:const Text('Exporter mes données')),
      TextButton(onPressed:busy?null:remove,child:const Text('Supprimer mon compte')),
    ],
    if(data!=null && tab==1)...[
      Text('${data!['silver']} Silver • ${data!['golden']} Golden',style:Theme.of(context).textTheme.headlineSmall),
      FilledButton(onPressed:busy?null:()=>run(()async{final result=await widget.api.call('/wallet/daily-bonus',body:{});await fetch();if(mounted)setState(()=>notice='Bonus du ${result['day']} : ${result['amount']} Silver confirmés.');}),child:const Text('Réclamer le bonus quotidien')),
      if((data!['entries'] as List).isEmpty)const Text('Aucune opération.'),
      for(final row in data!['entries'] as List)ListTile(title:Text('${row['amount']} ${row['currency']}'),subtitle:Text('${row['reason']} • ${row['created_at']}')),
    ],
    if(data!=null && tab==2)...[
      TextField(controller:friend,decoration:const InputDecoration(labelText:'Pseudo exact à inviter')),
      FilledButton(onPressed:busy?null:()=>action('/friends',{'action':'request','pseudo':friend.text}),child:const Text('Demander en ami')),
      TextField(controller:inviteCode,maxLength:6,textCapitalization:TextCapitalization.characters,decoration:const InputDecoration(labelText:'Code de votre salle pour inviter un ami')),
      for(final item in data!['items'] as List)Card(child:Padding(padding:const EdgeInsets.all(12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text('${item['pseudo']} • ${item['status']}'),Wrap(children:[
          if(item['status']=='pending' && item['recipient_id']==widget.userId)TextButton(onPressed:busy?null:()=>action('/friends',{'action':'accept','userId':item['id']}),child:const Text('Accepter')),
          if(item['status']=='pending' && item['recipient_id']==widget.userId)TextButton(onPressed:busy?null:()=>action('/friends',{'action':'decline','userId':item['id']}),child:const Text('Refuser')),
          if(item['status']=='accepted')TextButton(onPressed:busy?null:()=>action('/invitations',{'code':inviteCode.text.toUpperCase(),'userId':item['id']}),child:const Text('Inviter dans la salle')),
          if(item['status']!='declined')TextButton(onPressed:busy?null:()=>action('/friends',{'action':'remove','userId':item['id']}),child:const Text('Retirer')),
        ]),
      ]))),
      if((data!['items'] as List).isEmpty)const Text('Aucun ami ni demande.'),
      const Text('Invitations reçues'),for(final item in invitations)ListTile(title:Text('${item['sender']} • ${item['name']}'),subtitle:Text('${item['status']}'),trailing:item['status']=='lobby'?TextButton(onPressed:()=>Navigator.pop(context,{'join':item['code']}),child:const Text('Rejoindre')):null),
    ],
    if(data!=null && tab==3)...[
      if((data!['items'] as List).isEmpty)const Text('Aucune partie terminée.'),
      for(final row in data!['items'] as List)ListTile(title:Text('${row['name']} • ${row['mode']}'),subtitle:Text('Rang ${row['rank']} • ${row['score']} points • ${row['finished_at']}')),
    ],
    if(data!=null && tab>0)Wrap(children:[if(offset>0)TextButton(onPressed:busy?null:(){offset=(offset-25).clamp(0,1000000);load();},child:const Text('Précédent')),if(data!['nextOffset']!=null)TextButton(onPressed:busy?null:(){offset=data!['nextOffset'] as int;load();},child:const Text('Suivant'))]),
  ]));
}
