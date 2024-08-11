import { Controller }  from './Controller'

export class PingController extends Controller{

    /**
     * Read all versions and return them
     *
     * @return json cotent
     */
    ping = async () => {
        return  {alive:true}
    }

}