import 'package:flutter/material.dart';
import 'api.dart';

class PlaySetupPage extends StatefulWidget {
  final QuizApi api;
  const PlaySetupPage({super.key,required this.api});
  @override
  State<PlaySetupPage> createState()=>_PlaySetupPageState();
}
class _PlaySetupPageState extends State<PlaySetupPage> {
  final name=TextEditingController(text:'Quiz entre amis');
  List<dynamic> categories=[],publicRooms=[];
  final selected=<String>{};
  String mode='room',language='fr',visibility='private';
  int count=3,duration=10;
  bool busy=true;
  String? error;
  @override
  void initState(){super.initState();load();}
  Future<void> load()async{
    try{final result=await Future.wait([widget.api.call('/catalog/categories'),widget.api.call('/rooms?limit=25')]);if(mounted)setState((){categories=result[0]['categories'] as List;publicRooms=result[1]['items'] as List;});}
    catch(e){if(mounted)setState(()=>error=e.toString());}finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> create()async{
    setState((){busy=true;error=null;});
    try{final state=await widget.api.call(mode=='solo'?'/solo':mode=='duel'?'/duels':'/rooms',body:{'name':name.text,'categories':selected.toList(),'language':language,'visibility':visibility,'questionCount':count,'durationMs':duration*1000});if(mounted && context.mounted)Navigator.pop(context,state);}
    catch(e){if(mounted)setState(()=>error=e.toString());}finally{if(mounted)setState(()=>busy=false);}
  }
  @override
  void dispose(){name.dispose();super.dispose();}
  @override
  Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('Préparer une partie')),body:ListView(padding:const EdgeInsets.all(20),children:[
    if(busy)const LinearProgressIndicator(),if(error!=null)Text(error!),
    DropdownButtonFormField<String>(value:mode,decoration:const InputDecoration(labelText:'Mode'),items:const [DropdownMenuItem(value:'room',child:Text('Salle entre amis')),DropdownMenuItem(value:'solo',child:Text('Solo')),DropdownMenuItem(value:'duel',child:Text('Duel'))],onChanged:busy?null:(x)=>setState(()=>mode=x!)),
    TextField(controller:name,maxLength:80,decoration:const InputDecoration(labelText:'Nom de la partie')),
    DropdownButtonFormField<String>(value:language,decoration:const InputDecoration(labelText:'Langue des questions'),items:['fr','en','ar'].map((x)=>DropdownMenuItem(value:x,child:Text(x))).toList(),onChanged:busy?null:(x)=>setState(()=>language=x!)),
    const Text('Catégories (aucune sélection = toutes les catégories disponibles)'),
    Wrap(spacing:8,children:[for(final category in categories)FilterChip(label:Text('${category['name']} (${category['questions']})'),selected:selected.contains(category['slug']),onSelected:busy?null:(value)=>setState((){if(value){selected.add(category['slug'] as String);}else{selected.remove(category['slug']);}}))]),
    if(!busy&&categories.isEmpty)const Text('Aucun catalogue réel disponible. Une publication éditoriale est nécessaire.'),
    DropdownButtonFormField<int>(value:count,decoration:const InputDecoration(labelText:'Questions'),items:[1,3,5,10,20].map((x)=>DropdownMenuItem(value:x,child:Text('$x'))).toList(),onChanged:busy?null:(x)=>setState(()=>count=x!)),
    DropdownButtonFormField<int>(value:duration,decoration:const InputDecoration(labelText:'Secondes par question'),items:[10,15,20,30].map((x)=>DropdownMenuItem(value:x,child:Text('$x'))).toList(),onChanged:busy?null:(x)=>setState(()=>duration=x!)),
    if(mode!='solo')SwitchListTile(title:const Text('Salle publique'),subtitle:const Text('Une salle privée se rejoint avec son code ou son lien.'),value:visibility=='public',onChanged:busy?null:(value)=>setState(()=>visibility=value?'public':'private')),
    FilledButton(onPressed:busy||categories.isEmpty?null:create,child:Text(mode=='solo'?'Commencer en solo':'Créer la partie')),
    const Text('Salles publiques'),for(final room in publicRooms)ListTile(title:Text('${room['name']}'),subtitle:Text('${room['mode']} • ${room['players']} joueurs'),trailing:TextButton(onPressed:busy?null:()async{setState(()=>busy=true);try{final state=await widget.api.call('/rooms/${room['code']}/join',body:{});if(mounted && context.mounted)Navigator.pop(context,state);}catch(e){if(mounted)setState(()=>error=e.toString());}finally{if(mounted)setState(()=>busy=false);}},child:const Text('Rejoindre'))),
  ]));
}
