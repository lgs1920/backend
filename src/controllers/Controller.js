export class Controller {


      BACKEND='../backend/'
      STUDIO = '../studio/'

    constructor() {
    }

    setStudioWorkingDirectory= () => {
        return process.env.NODE_ENV==='production'?`${this.STUDIO}dist/`:this.STUDIO
    }
    setPublicName= (name) => {
        return  `${this.setStudioWorkingDirectory()}${process.env.NODE_ENV==='production'?'':'public/'}${name}`
    }
    setPublicDirectoryName= (name) => {
      return this.setPublicName(name)+'/'
    }
}